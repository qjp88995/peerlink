/** 易读易念的常用中文名词词库，用于短口令的词部分。 */
export const WORDS = [
  '河马',
  '老虎',
  '熊猫',
  '海豚',
  '企鹅',
  '孔雀',
  '骆驼',
  '刺猬',
  '松鼠',
  '狐狸',
  '袋鼠',
  '考拉',
  '鲸鱼',
  '章鱼',
  '蝴蝶',
  '萤火虫',
  '苹果',
  '香蕉',
  '菠萝',
  '西瓜',
  '草莓',
  '柠檬',
  '葡萄',
  '樱桃',
  '月亮',
  '星星',
  '彩虹',
  '闪电',
  '火山',
  '海浪',
  '森林',
  '雪花',
];

/**
 * 生成「4 位数字-中文词」短口令，如 `8423-河马`。
 * rng 默认 Math.random，可注入以便测试。
 */
export function generateRoomId(rng: () => number = Math.random): string {
  const digits = String(Math.floor(rng() * 10000)).padStart(4, '0');
  const word = WORDS[Math.floor(rng() * WORDS.length)];
  return `${digits}-${word}`;
}
