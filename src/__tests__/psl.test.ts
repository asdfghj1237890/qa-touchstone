import { describe, it, expect } from 'vitest';
import { isPublicSuffix, publicSuffixOf, publicSuffixLabelCount } from '../qa/psl';

// 案例取自 publicsuffix.org 官方 test_psl.txt 的代表向量 +
// cookie jar 實際攻擊面（supercookie Domain 屬性）。

describe('PSL — 一般規則', () => {
  it('TLD 本身是公共後綴（default rule 與一般規則）', () => {
    expect(isPublicSuffix('com')).toBe(true);
    expect(isPublicSuffix('org')).toBe(true);
    expect(isPublicSuffix('jp')).toBe(true);
    // 未知 TLD 套 default rule `*`
    expect(isPublicSuffix('this-tld-does-not-exist')).toBe(true);
  });

  it('可註冊網域不是公共後綴', () => {
    expect(isPublicSuffix('example.com')).toBe(false);
    expect(isPublicSuffix('api.example.com')).toBe(false);
  });

  it('二級公共後綴（舊手工清單的守備範圍）', () => {
    expect(isPublicSuffix('co.uk')).toBe(true);
    expect(isPublicSuffix('co.jp')).toBe(true);
    expect(isPublicSuffix('com.au')).toBe(true);
    expect(isPublicSuffix('example.co.uk')).toBe(false);
    expect(publicSuffixOf('www.example.co.uk')).toBe('co.uk');
  });

  it('PRIVATE 區段的 SaaS 後綴', () => {
    expect(isPublicSuffix('github.io')).toBe(true);
    expect(isPublicSuffix('foo.github.io')).toBe(false); // 使用者站台可自設 cookie
  });

  it('三級以上規則（舊清單抓不到的）', () => {
    // PSL 一般規則含多 label 條目，例如日本地方政府／AWS 私有區段
    expect(publicSuffixLabelCount('foo.s3.amazonaws.com')).toBeGreaterThanOrEqual(3);
    expect(isPublicSuffix('s3.amazonaws.com')).toBe(true);
  });
});

describe('PSL — 萬用字元與例外規則', () => {
  it('*.ck：任意子標籤是公共後綴', () => {
    expect(isPublicSuffix('foo.ck')).toBe(true);
    expect(isPublicSuffix('anything.ck')).toBe(true);
    expect(isPublicSuffix('bar.foo.ck')).toBe(false); // 註冊在 foo.ck 之下
  });

  it('!www.ck：例外規則勝過萬用字元', () => {
    expect(isPublicSuffix('www.ck')).toBe(false);
    expect(publicSuffixOf('www.ck')).toBe('ck');
  });

  it('*.kawasaki.jp 與 !city.kawasaki.jp', () => {
    expect(isPublicSuffix('foo.kawasaki.jp')).toBe(true);
    expect(isPublicSuffix('city.kawasaki.jp')).toBe(false);
  });
});

describe('PSL — 正規化與邊界', () => {
  it('大小寫、前後點正規化', () => {
    expect(isPublicSuffix('CO.UK')).toBe(true);
    expect(isPublicSuffix('.co.uk')).toBe(true);
    expect(isPublicSuffix('co.uk.')).toBe(true);
    expect(isPublicSuffix('.Example.COM')).toBe(false);
  });

  it('空值視同拒絕', () => {
    expect(isPublicSuffix('')).toBe(true);
    expect(isPublicSuffix('   ')).toBe(true);
  });
});

describe('PSL — supercookie 攻擊面（cookie jar 的實際用法）', () => {
  it('拒絕把 Domain 設在公共後綴的企圖', () => {
    for (const evil of ['com', 'co.uk', 'github.io', 's3.amazonaws.com', 'xyz.compute.amazonaws.com']) {
      expect(isPublicSuffix(evil), `Domain=${evil} 必須被拒`).toBe(true);
    }
  });

  it('amazonaws.com / compute.amazonaws.com 是可註冊網域，不是公共後綴（PSL 如此；瀏覽器同）', () => {
    expect(isPublicSuffix('amazonaws.com')).toBe(false);
    // *.compute.amazonaws.com 是萬用字元規則：base 本身不是公共後綴，子網域才是。
    expect(isPublicSuffix('compute.amazonaws.com')).toBe(false);
  });

  it('正常的 Domain 放寬不受影響', () => {
    for (const ok of ['example.com', 'api.example.co.uk', 'myapp.github.io']) {
      expect(isPublicSuffix(ok), `Domain=${ok} 應放行`).toBe(false);
    }
  });
});
