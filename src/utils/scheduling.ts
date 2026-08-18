export const getNextScheduledTime = (): Date => {
  const now = new Date();
  const scanTime = new Date(now.getTime());
  scanTime.setUTCSeconds(0, 0);

  // Scan forward up to 24 hours to find the next valid 15-minute slot matching UTC hours 8-23 or 0-1
  for (let i = 0; i < 2000; i++) {
    scanTime.setUTCMinutes(scanTime.getUTCMinutes() + 1);
    const utcHour = scanTime.getUTCHours();
    const utcMin = scanTime.getUTCMinutes();

    const isValidHour = (utcHour >= 8 && utcHour <= 23) || (utcHour >= 0 && utcHour <= 1);
    const isValidMin = utcMin % 15 === 0;

    if (isValidHour && isValidMin) {
      return scanTime;
    }
  }
  return new Date(now.getTime() + 15 * 60 * 1000);
};

export const formatToPortugal = (date: Date): string => {
  const optionsDate: Intl.DateTimeFormatOptions = {
    timeZone: "Europe/Lisbon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  };

  const optionsTime: Intl.DateTimeFormatOptions = {
    timeZone: "Europe/Lisbon",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };

  try {
    const portugalDateStr = new Intl.DateTimeFormat("pt-PT", optionsDate).format(date);
    const portugalTimeStr = new Intl.DateTimeFormat("pt-PT", optionsTime).format(date);

    const todayPortugalStr = new Intl.DateTimeFormat("pt-PT", optionsDate).format(new Date());

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowPortugalStr = new Intl.DateTimeFormat("pt-PT", optionsDate).format(tomorrow);

    if (portugalDateStr === todayPortugalStr) {
      return `today at ${portugalTimeStr}`;
    } else if (portugalDateStr === tomorrowPortugalStr) {
      return `tomorrow at ${portugalTimeStr}`;
    } else {
      return `${portugalDateStr} at ${portugalTimeStr}`;
    }
  } catch (err) {
    return date.toLocaleTimeString([], { timeZone: "Europe/Lisbon" });
  }
};

/**
 * Extracts accurate Lisbon timezone date/time parts and calculates the
 * Theatrical Operational Date (06:00 -> 05:59 Lisbon cutoff).
 */
export interface LisbonTimeInfo {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  formattedTime: string; // "HH:mm"
  calendarDate: string;  // "YYYY-MM-DD"
  operationalDate: string; // "YYYY-MM-DD"
}

export const getLisbonTimeParts = (date: Date = new Date()): LisbonTimeInfo => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Lisbon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const partMap: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") {
      partMap[p.type] = p.value;
    }
  }

  let hour = parseInt(partMap.hour, 10);
  if (hour === 24) hour = 0;
  const minute = parseInt(partMap.minute, 10);
  const second = parseInt(partMap.second, 10);
  const year = parseInt(partMap.year, 10);
  const month = parseInt(partMap.month, 10);
  const day = parseInt(partMap.day, 10);

  const formattedTime = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const calendarDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  // Theatrical Operational Day:
  // Theatrical day runs from 06:00:00 to 05:59:59 Lisbon time.
  // If Lisbon local hour is < 6 (i.e. 00:00 - 05:59), the operational date belongs to the previous calendar day.
  let operationalDate = calendarDate;
  if (hour < 6) {
    const prevDay = new Date(Date.UTC(year, month - 1, day - 1));
    operationalDate = prevDay.toISOString().split("T")[0];
  }

  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    formattedTime,
    calendarDate,
    operationalDate,
  };
};

export const getCurrentLisbonTime = (date: Date = new Date()): string => {
  return getLisbonTimeParts(date).formattedTime;
};

export const getCurrentTheatricalOperationalDate = (date: Date = new Date()): string => {
  return getLisbonTimeParts(date).operationalDate;
};

