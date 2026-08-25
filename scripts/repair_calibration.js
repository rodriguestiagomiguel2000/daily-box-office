import { query } from "../server/db";
import { getMovieResolvedPricesForCalibration, syncCalibrationFactorsToDb } from "../server/revenue";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

async function runRepair() {
  console.log("=== STARTING CALIBRATION FACTORS DATA REPAIR ===");

  // 1. Reset Postgres calibration_factors table
  console.log("[repair] Clearing movie-specific factors from Postgres calibration_factors table...");
  await query("DELETE FROM calibration_factors WHERE movie_id IS NOT NULL;");

  // 2. Reset calibration_factors.json file
  const jsonPath = path.join(process.cwd(), "calibration_factors.json");
  const baselineJson = {
    category_factors: {
      "Family / Animation": 0.80,
      "Action / General": 0.90,
      "Drama / Adult": 0.93
    },
    movie_specific_factors: {},
    sample_counts: {},
    last_updated: new Date().toISOString()
  };
  fs.writeFileSync(jsonPath, JSON.stringify(baselineJson, null, 2), "utf-8");
  console.log("[repair] Reset calibration_factors.json to baseline defaults.");

  // 3. Fetch weekly reference prices from DB
  console.log("[repair] Computing weekly resolved reference prices from Postgres...");
  const moviePrices = await getMovieResolvedPricesForCalibration();
  // Pass weekly prices for weekly-only recomputation
  const pricesPayload = JSON.stringify({ weekly: moviePrices.weekly });

  // 4. Run python ICA calibration update with --weekly-only and --reset-first
  console.log("[repair] Running ICA calibration update (weekly-only, reset-first)...");
  const calibrationOutput = await new Promise((resolve, reject) => {
    const py = spawn(
      "python3",
      ["run_ica_calibration_update.py", "--prices-json", pricesPayload, "--weekly-only", "--reset-first"],
      { cwd: process.cwd() }
    );

    let stdout = "";
    let stderr = "";

    py.stdout.on("data", (d) => (stdout += d.toString()));
    py.stderr.on("data", (d) => (stderr += d.toString()));

    py.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`ICA script failed (exit code ${code}): ${stderr || stdout}`));
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        resolve(parsed);
      } catch (jsonErr) {
        reject(new Error(`Failed to parse ICA output: ${stdout || jsonErr.message}`));
      }
    });
  });

  // 5. Sync results to DB and trigger snapshot recalculation
  console.log("[repair] Syncing repaired factors to Postgres DB...");
  const syncStats = await syncCalibrationFactorsToDb(calibrationOutput);
  console.log(`[repair] Sync complete: ${syncStats.categoriesUpdated} categories, ${syncStats.moviesUpdated} movies updated.`);

  // 6. Query and display specific target movies
  const res = await query(
    `SELECT cf.id, cf.movie_id, m.title, cf.category, cf.gamma, cf.sample_count, cf.updated_at
     FROM calibration_factors cf
     JOIN movies m ON cf.movie_id = m.id
     WHERE m.title ILIKE '%Homem-Aranha%' OR m.title ILIKE '%Odisseia%' OR m.title ILIKE '%Patrulha%'
     ORDER BY m.title;`
  );

  console.log("\n=== REPAIRED FACTORS FOR TARGET MOVIES ===");
  for (const row of res.rows) {
    console.log(`Movie: ${row.title} (ID ${row.movie_id}) -> Category: ${row.category}, Gamma: ${row.gamma}, Samples: ${row.sample_count}`);
  }

  const catRes = await query("SELECT category, gamma, sample_count FROM calibration_factors WHERE movie_id IS NULL;");
  console.log("\n=== REPAIRED CATEGORY FACTORS ===");
  for (const row of catRes.rows) {
    console.log(`Category: ${row.category} -> Gamma: ${row.gamma}, Samples: ${row.sample_count}`);
  }

  process.exit(0);
}

runRepair().catch((err) => {
  console.error("Repair failed:", err);
  process.exit(1);
});
