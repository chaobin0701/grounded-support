export type Product = {
  id: string;
  name: string;
  categoryId: string;
  summary: string;
  specifications: Record<string, string>;
};

// Fictional catalogue for the MCP learning exercise; it is not commercial inventory.
export const categories = [
  { id: 'heating', name: '取暖电器' },
  { id: 'lighting', name: '照明电器' },
  { id: 'air', name: '空气电器' },
] as const;

export const products: Product[] = [
  { id: 'heater-h1', name: '暖巢 H1 暖风机', categoryId: 'heating', summary: '桌面与小空间使用的暖风机。', specifications: { 额定功率: '1200 W', 档位: '低档 / 高档', 额定电压: '220 V', 尺寸: '210 × 145 × 255 mm' } },
  { id: 'heater-h2', name: '暖巢 H2 陶瓷暖风机', categoryId: 'heating', summary: '适合卧室的小型陶瓷暖风机。', specifications: { 额定功率: '1500 W', 档位: '三档', 额定电压: '220 V', 尺寸: '230 × 170 × 300 mm' } },
  { id: 'lamp-l1', name: '星屿 L1 护眼台灯', categoryId: 'lighting', summary: '适合书桌阅读的 LED 台灯。', specifications: { 额定功率: '12 W', 色温: '3000–5000 K', 调光: '五级', 供电: '24 V DC' } },
  { id: 'lamp-l2', name: '星屿 L2 便携台灯', categoryId: 'lighting', summary: '可充电的便携式 LED 台灯。', specifications: { 额定功率: '6 W', 色温: '4000 K', 电池容量: '4000 mAh', 调光: '三级' } },
  { id: 'purifier-a1', name: '清屿 A1 空气净化器', categoryId: 'air', summary: '用于日常室内空气净化。', specifications: { 额定功率: '38 W', 颗粒物CADR: '300 m³/h', 适用面积: '20–35 m²', 尺寸: '245 × 245 × 480 mm' } },
];
