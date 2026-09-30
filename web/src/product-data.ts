export type WebsiteProduct = {
  slug: string;
  brand: string;
  name: string;
  category: string;
  intro: string;
  image: string;
  suggestedPrice: string;
  specs: { label: string; value: string }[];
};

export const websiteProducts: WebsiteProduct[] = [
  {
    slug: 'midea-hft20zbj', brand: 'Midea', name: '美的塔式暖风机 HFT20ZBJ', category: '取暖',
    intro: '面向小空间的塔式取暖器，强调快速升温与基础安全保护。',
    image: 'https://oss-accelerate-ga.midea.com/vision-material-634-public-prd-g5-cdn/material_gpim/20260426/0f6e75e87b8ef78d58846cc2ebc49f85.jpg', suggestedPrice: '参考 ¥343',
    specs: [{ label: '额定功率', value: '2000 W' }, { label: '适用面积', value: '10㎡以下' }, { label: '档位', value: '3 档' }, { label: '控制方式', value: '遥控' }],
  },
  {
    slug: 'xiaomi-electric-warmer', brand: 'Xiaomi', name: '米家电暖器', category: '取暖',
    intro: '对流式电暖器，适合卧室和书房等有限面积空间。',
    image: 'https://c1.mifile.cn/f/i/16/chain/warmer-electric/specs-1.jpg', suggestedPrice: '以官方渠道为准',
    specs: [{ label: '额定功率', value: '1500 W' }, { label: '适用面积', value: '15㎡以内' }, { label: '控制方式', value: '机械 + 触摸 + App' }, { label: '防护等级', value: 'IPX4' }],
  },
  {
    slug: 'xiaomi-air-purifier-pro', brand: 'Xiaomi', name: '米家空气净化器 Pro', category: '空气',
    intro: '以空气循环、传感器和 App 控制为重点的家用空气净化设备。',
    image: 'https://c1.mifile.cn/f/i/16/chain/airpro/airpro-02.jpg', suggestedPrice: '以官方渠道为准',
    specs: [{ label: '颗粒物 CADR', value: '500 m³/h' }, { label: '适用面积', value: '35–60㎡' }, { label: '显示', value: 'OLED' }, { label: '控制', value: '米家 App' }],
  },
  {
    slug: 'xiaomi-fresh-air-ventilator', brand: 'Xiaomi', name: '米家新风机', category: '空气',
    intro: '面向全屋通风的壁挂式设备，提供新风、过滤与辅助升温能力。',
    image: 'https://i1.mifile.cn/f/i/16/chain/fresh-air-ventilator/specs-01.jpg', suggestedPrice: '以官方渠道为准',
    specs: [{ label: '额定风量', value: '300 m³/h' }, { label: '适用面积', value: '≤105㎡' }, { label: '额定功率', value: '42 W' }, { label: '辅热功率', value: '800 W' }],
  },
];
