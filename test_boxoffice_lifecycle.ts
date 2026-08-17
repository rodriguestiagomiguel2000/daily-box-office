import { 
  getMovieRunDay, 
  getMovieWeekendNumber, 
  getMovieWeekNumber, 
  getMovieOpeningWeekendThu, 
  getTheatricalWeekStart, 
  getDayDifference,
  addDays
} from "./server/boxoffice";

function assertEqual(actual: any, expected: any, message: string) {
  if (actual !== expected) {
    console.error(`❌ FAILED: ${message}`);
    console.error(`   Expected: ${JSON.stringify(expected)}`);
    console.error(`   Actual:   ${JSON.stringify(actual)}`);
    process.exit(1);
  } else {
    console.log(`✅ PASSED: ${message}`);
  }
}

console.log("\n==========================================");
console.log("TEST SUITE: THEATRICAL RUN & LIFECYCLE NUMBERING");
console.log("==========================================\n");

// 1. User Prompt Primary Example
// Movie release date: Wednesday, July 29, 2026
const movieReleaseDate = "2026-07-29";

console.log("--- 1. Testing Run Day Calculation (Release Date = Day 1) ---");
assertEqual(getMovieRunDay(movieReleaseDate, "2026-07-29").run_day, 1, "2026-07-29 is Day 1");
assertEqual(getMovieRunDay(movieReleaseDate, "2026-07-29").run_day_label, "Day 1", "2026-07-29 label is Day 1");
assertEqual(getMovieRunDay(movieReleaseDate, "2026-07-30").run_day, 2, "2026-07-30 is Day 2");
assertEqual(getMovieRunDay(movieReleaseDate, "2026-07-31").run_day, 3, "2026-07-31 is Day 3");
assertEqual(getMovieRunDay(movieReleaseDate, "2026-08-01").run_day, 4, "2026-08-01 is Day 4");
assertEqual(getMovieRunDay(movieReleaseDate, "2026-08-02").run_day, 5, "2026-08-02 is Day 5");

// Critical test from prompt: tracker only started collecting on Aug 12
console.log("--- 2. Testing Missing Collection Days / Delayed Tracker Start ---");
assertEqual(getMovieRunDay(movieReleaseDate, "2026-08-12").run_day, 15, "2026-08-12 is Day 15 (NOT Day 1)");
assertEqual(getMovieRunDay(movieReleaseDate, "2026-08-12").run_day_label, "Day 15", "2026-08-12 label is Day 15");
assertEqual(getMovieRunDay(movieReleaseDate, "2026-08-13").run_day, 16, "2026-08-13 is Day 16");
assertEqual(getMovieRunDay(movieReleaseDate, "2026-08-14").run_day, 17, "2026-08-14 is Day 17");
assertEqual(getMovieRunDay(movieReleaseDate, "2026-08-15").run_day, 18, "2026-08-15 is Day 18");
assertEqual(getMovieRunDay(movieReleaseDate, "2026-08-16").run_day, 19, "2026-08-16 is Day 19");
assertEqual(getMovieRunDay(movieReleaseDate, "2026-08-17").run_day, 20, "2026-08-17 is Day 20");

// 3. Weekend # Calculation for Wednesday Release (2026-07-29)
console.log("--- 3. Testing Weekend # Calculation (Release Wed 2026-07-29) ---");
// Opening weekend is Thursday July 30 -> Sunday Aug 2
assertEqual(getMovieOpeningWeekendThu(movieReleaseDate), "2026-07-30", "Opening weekend anchor for Wed Jul 29 is Thu Jul 30");

// Weekend 1: 2026-07-30 (Thu Jul 30 - Sun Aug 2)
const w1 = getMovieWeekendNumber(movieReleaseDate, "2026-07-30");
assertEqual(w1.weekend_number, 1, "Weekend of Jul 30 - Aug 2 is Weekend #1");
assertEqual(w1.weekend_number_label, "Weekend #1", "Label is Weekend #1");

// Weekend 2: 2026-08-06 (Thu Aug 6 - Sun Aug 9)
const w2 = getMovieWeekendNumber(movieReleaseDate, "2026-08-06");
assertEqual(w2.weekend_number, 2, "Weekend of Aug 6 - Aug 9 is Weekend #2");
assertEqual(w2.weekend_number_label, "Weekend #2", "Label is Weekend #2");

// Weekend 3: 2026-08-13 (Thu Aug 13 - Sun Aug 16)
const w3 = getMovieWeekendNumber(movieReleaseDate, "2026-08-13");
assertEqual(w3.weekend_number, 3, "Weekend of Aug 13 - Aug 16 is Weekend #3 (NOT Weekend #1)");
assertEqual(w3.weekend_number_label, "Weekend #3", "Label is Weekend #3");

// 4. Week # Calculation for Wednesday Release (2026-07-29)
console.log("--- 4. Testing Week # Calculation (Release Wed 2026-07-29) ---");
// Week 1: Thursday July 23 -> Wednesday July 29
const wk1 = getMovieWeekNumber(movieReleaseDate, "2026-07-23");
assertEqual(wk1.week_number, 1, "Week of Jul 23 - Jul 29 is Week #1");
assertEqual(wk1.week_number_label, "Week #1", "Label is Week #1");

// Week 2: Thursday July 30 -> Wednesday Aug 5
const wk2 = getMovieWeekNumber(movieReleaseDate, "2026-07-30");
assertEqual(wk2.week_number, 2, "Week of Jul 30 - Aug 5 is Week #2");

// Week 3: Thursday Aug 6 -> Wednesday Aug 12
const wk3 = getMovieWeekNumber(movieReleaseDate, "2026-08-06");
assertEqual(wk3.week_number, 3, "Week of Aug 6 - Aug 12 is Week #3");

// Week 4: Thursday Aug 13 -> Wednesday Aug 19
const wk4 = getMovieWeekNumber(movieReleaseDate, "2026-08-13");
assertEqual(wk4.week_number, 4, "Week of Aug 13 - Aug 19 is Week #4 (NOT Week #1)");
assertEqual(wk4.week_number_label, "Week #4", "Label is Week #4");

// 5. Edge cases: All 7 days of the week for release date
console.log("--- 5. Testing Release Date on Every Day of the Week ---");

// Monday release: 2026-07-27 (Mon)
// Opens into Thu Jul 30 weekend (Weekend #1)
// Theatrical week containing Jul 27 is Thu Jul 23 - Wed Jul 29 (Week #1)
const monRel = "2026-07-27";
assertEqual(getMovieOpeningWeekendThu(monRel), "2026-07-30", "Monday release opening weekend is next Thursday");
assertEqual(getMovieWeekendNumber(monRel, "2026-07-30").weekend_number, 1, "Mon release: Weekend of Jul 30 is Weekend #1");
assertEqual(getMovieWeekNumber(monRel, "2026-07-23").week_number, 1, "Mon release: Week containing Mon is Week #1");

// Tuesday release: 2026-07-28 (Tue)
const tueRel = "2026-07-28";
assertEqual(getMovieOpeningWeekendThu(tueRel), "2026-07-30", "Tuesday release opening weekend is next Thursday");
assertEqual(getMovieWeekendNumber(tueRel, "2026-07-30").weekend_number, 1, "Tue release: Weekend of Jul 30 is Weekend #1");
assertEqual(getMovieWeekNumber(tueRel, "2026-07-23").week_number, 1, "Tue release: Week containing Tue is Week #1");

// Wednesday release: 2026-07-29 (Wed)
const wedRel = "2026-07-29";
assertEqual(getMovieOpeningWeekendThu(wedRel), "2026-07-30", "Wednesday release opening weekend is next Thursday");
assertEqual(getMovieWeekendNumber(wedRel, "2026-07-30").weekend_number, 1, "Wed release: Weekend of Jul 30 is Weekend #1");
assertEqual(getMovieWeekNumber(wedRel, "2026-07-23").week_number, 1, "Wed release: Week containing Wed is Week #1");

// Thursday release: 2026-07-30 (Thu)
const thuRel = "2026-07-30";
assertEqual(getMovieOpeningWeekendThu(thuRel), "2026-07-30", "Thursday release opening weekend is same Thursday");
assertEqual(getMovieWeekendNumber(thuRel, "2026-07-30").weekend_number, 1, "Thu release: Weekend of Jul 30 is Weekend #1");
assertEqual(getMovieWeekNumber(thuRel, "2026-07-30").week_number, 1, "Thu release: Week starting Thu is Week #1");

// Friday release: 2026-07-31 (Fri)
const friRel = "2026-07-31";
assertEqual(getMovieOpeningWeekendThu(friRel), "2026-07-30", "Friday release opening weekend is Thursday of that weekend");
assertEqual(getMovieWeekendNumber(friRel, "2026-07-30").weekend_number, 1, "Fri release: Weekend of Jul 30 is Weekend #1");
assertEqual(getMovieWeekNumber(friRel, "2026-07-30").week_number, 1, "Fri release: Week starting Thu Jul 30 is Week #1");

// Saturday release: 2026-08-01 (Sat)
const satRel = "2026-08-01";
assertEqual(getMovieOpeningWeekendThu(satRel), "2026-07-30", "Saturday release opening weekend is Thursday of that weekend");
assertEqual(getMovieWeekendNumber(satRel, "2026-07-30").weekend_number, 1, "Sat release: Weekend of Jul 30 is Weekend #1");
assertEqual(getMovieWeekNumber(satRel, "2026-07-30").week_number, 1, "Sat release: Week starting Thu Jul 30 is Week #1");

// Sunday release: 2026-08-02 (Sun)
const sunRel = "2026-08-02";
assertEqual(getMovieOpeningWeekendThu(sunRel), "2026-07-30", "Sunday release opening weekend is Thursday of that weekend");
assertEqual(getMovieWeekendNumber(sunRel, "2026-07-30").weekend_number, 1, "Sun release: Weekend of Jul 30 is Weekend #1");
assertEqual(getMovieWeekNumber(sunRel, "2026-07-30").week_number, 1, "Sun release: Week starting Thu Jul 30 is Week #1");

console.log("\n==========================================");
console.log("🎉 ALL TESTS COMPLETED AND VERIFIED SUCCESSFULLY!");
console.log("==========================================\n");
