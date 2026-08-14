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
