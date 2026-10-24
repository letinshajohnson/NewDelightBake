export const CURRENCIES = {
  INR: { symbol: "₹", decimals: 2, locale: "en-IN" },
  USD: { symbol: "$", decimals: 2, locale: "en-US" },
  IDR: { symbol: "Rp", decimals: 0, locale: "id-ID" },
  KWD: { symbol: "KD", decimals: 3, locale: "en-KW" },
};

const cur = (c) => CURRENCIES[c] || CURRENCIES.INR;

export function fmt(minor, c = "INR") {
  const { symbol, decimals, locale } = cur(c);
  const v = (minor || 0) / 10 ** decimals;
  const s = Math.abs(v).toLocaleString(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${v < 0 ? "-" : ""}${symbol}${s}`;
}

// Parse a typed amount string into integer minor units without float math.
export function toMinor(str, c = "INR") {
  const { decimals } = cur(c);
  const s = String(str ?? "").trim().replace(/,/g, "");
  if (!s || !/^-?\d*(\.\d*)?$/.test(s)) return 0;
  const neg = s.startsWith("-");
  const [i, f = ""] = s.replace("-", "").split(".");
  const v = parseInt(i || "0", 10) * 10 ** decimals + parseInt((f + "000").slice(0, decimals) || "0", 10);
  return neg ? -v : v;
}

export function toMajorStr(minor, c = "INR") {
  const { decimals } = cur(c);
  if (!decimals) return String(minor || 0);
  const v = Math.abs(minor || 0);
  return `${minor < 0 ? "-" : ""}${Math.floor(v / 10 ** decimals)}.${String(v % 10 ** decimals).padStart(decimals, "0")}`;
}

export const pctStr = (bps) => `${(bps || 0) / 100}%`;
export const toBps = (str) => Math.round(parseFloat(str || "0") * 100) || 0;
