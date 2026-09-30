export type Product = {
  id: string;
  name: string;
  categoryId: string;
  summary: string;
  specifications: Record<string, string>;
};

// Learning/demo catalogue. The branded entries below are normalized from
// public official specification pages and are not commercial inventory.
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
  { id: 'midea-hft20zbj', name: '美的塔式暖风机 HFT20ZBJ', categoryId: 'heating', summary: '美的官方规格参考：适合 10㎡以下空间，支持遥控。', specifications: { 额定功率: '2000 W', 适用面积: '10㎡以下', 档位: '3 档', 控制方式: '遥控' } },
  { id: 'xiaomi-electric-warmer', name: '米家电暖器', categoryId: 'heating', summary: '小米官方规格参考：对流式电暖器，支持 App 操控。', specifications: { 额定功率: '1500 W', 适用面积: '15㎡以内', 防护等级: 'IPX4', 控制方式: '机械开关 + 触摸按键 + APP' } },
  { id: 'xiaomi-air-purifier-pro', name: '米家空气净化器 Pro', categoryId: 'air', summary: '小米官方规格参考：500m³/h 颗粒物 CADR，适用 35–60㎡。', specifications: { 颗粒物CADR: '500 m³/h', 适用面积: '35–60 m²', 显示: 'OLED', 控制方式: '米家 App' } },
  { id: 'xiaomi-fresh-air-ventilator', name: '米家新风机', categoryId: 'air', summary: '小米官方规格参考：额定风量 300m³/h，支持辅助升温。', specifications: { 额定风量: '300 m³/h', 适用面积: '≤105 m²', 额定功率: '42 W', 辅热功率: '800 W' } },
];
