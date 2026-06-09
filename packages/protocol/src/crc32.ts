const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

/** 可增量更新的 CRC-32（IEEE 802.3）计算器。 */
export class Crc32 {
  private crc = 0xffffffff;

  update(data: Uint8Array): this {
    let crc = this.crc;
    for (let i = 0; i < data.length; i++) {
      crc = (CRC32_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
    }
    this.crc = crc;
    return this;
  }

  digest(): number {
    return (this.crc ^ 0xffffffff) >>> 0;
  }
}

/** 一次性计算整段数据的 CRC-32。 */
export function crc32(data: Uint8Array): number {
  return new Crc32().update(data).digest();
}
