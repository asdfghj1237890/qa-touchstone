// ── QA Touchstone — Public Suffix List 完整實作 ─────────────────────────────
// 取代 engine.ts 舊的手工 ~300 條 QA_PUBLIC_SUFFIX_2 清單。cookie jar 用
// isPublicSuffix() 拒絕把 Domain 屬性設在公共後綴上（supercookie 防禦）：
// 沒有它，惡意 API 回 `Set-Cookie: x=1; Domain=co.uk` 後，這顆 cookie 會
// 自動送往之後測的所有 *.co.uk 主機。
//
// 演算法依 https://publicsuffix.org/list/ 規格：
//   1. 由長到短掃描候選後綴；例外規則（!）一中即勝。
//   2. 否則取最長匹配規則（一般規則 or 萬用字元 `*.base`）。
//   3. 全部未中時套用 default rule `*`（任何 TLD 本身都是公共後綴）。
// 已知限制：不做 IDN punycode 正規化 —— 比對以小寫原字串進行，
// PSL 內的 unicode 規則只匹配同形式的輸入（本工具的 Domain 屬性
// 實務上幾乎都是 ASCII host）。
import { PSL_RULES, PSL_WILDCARDS, PSL_EXCEPTIONS } from './psl.data';

const RULES = new Set<string>(PSL_RULES);
const WILDCARDS = new Set<string>(PSL_WILDCARDS);
const EXCEPTIONS = new Set<string>(PSL_EXCEPTIONS);

function normalize(domain: string): string {
  return String(domain || '')
    .trim()
    .toLowerCase()
    .replace(/^\.+/, '')
    .replace(/\.+$/, '');
}

/**
 * 回傳 domain 的公共後綴佔幾個 label（自尾端起算）。
 * 例：example.co.uk → 2（co.uk）；foo.ck（*.ck）→ 2；www.ck（!www.ck）→ 1。
 */
export function publicSuffixLabelCount(domain: string): number {
  const d = normalize(domain);
  if (!d) return 0;
  const labels = d.split('.');
  let best = 1; // default rule `*`
  for (let i = 0; i < labels.length; i++) {
    const candidate = labels.slice(i).join('.');
    // 例外規則一中即勝：公共後綴 = 例外規則去掉最左 label。
    if (EXCEPTIONS.has(candidate)) return labels.length - i - 1;
    if (RULES.has(candidate)) best = Math.max(best, labels.length - i);
    // 萬用字元規則 `*.base`：candidate 的「去掉最左 label 後的尾巴」== base。
    const base = labels.slice(i + 1).join('.');
    if (base && WILDCARDS.has(base)) best = Math.max(best, labels.length - i);
  }
  return best;
}

/** domain 的公共後綴字串（example.co.uk → 'co.uk'）。 */
export function publicSuffixOf(domain: string): string {
  const d = normalize(domain);
  if (!d) return '';
  const labels = d.split('.');
  const n = publicSuffixLabelCount(d);
  return labels.slice(labels.length - n).join('.');
}

/**
 * domain 本身是否為公共後綴（= cookie 的 Domain 屬性必須拒絕）。
 * 涵蓋單一標籤（com、未知 TLD）、PSL 一般/萬用字元規則；
 * 例外規則命中者（如 www.ck）視為可註冊網域、回 false。
 */
export function isPublicSuffix(domain: string): boolean {
  const d = normalize(domain);
  if (!d) return true; // 空值視同拒絕
  return d.split('.').length <= publicSuffixLabelCount(d);
}
