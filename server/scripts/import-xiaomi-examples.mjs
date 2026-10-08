// Explicit, opt-in catalog data operation; never run during application startup.
// Run from repository root: node --env-file=.env server/scripts/import-xiaomi-examples.mjs [--apply]
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { Pool } from 'pg';

const priceSource = 'https://s1.mi.com/pages/dcb8f45f8e51d8dc00940da661ffba9d/index.html';
const entries = [
  ['fan-1x', '米家直流变频落地扇 1X', 'cooling', '风扇', 'airfan1x', '直流变频落地扇，支持米家 App 控制。', { '额定功率': '15 W', '额定电压': '220 V / 50 Hz', '风量': '23.1 m³/min', '最低噪声': '26.6 dB(A)', '净重': '2.8 kg', '连接方式': '2.4 GHz Wi-Fi' }],
  ['ih-rice-cooker-3l', '米家智能 IH 电饭煲 3L', 'kitchen', '厨房电器', 'dianfanbao2', '3L 容量的 IH 加热电饭煲，支持 Wi-Fi 连接。', { '型号': 'IHFB01CM', '容量': '3.0 L', '额定功率': '1130 W', '额定电压': '220 V / 50 Hz', '加热方式': 'IH', '连接方式': '2.4 GHz Wi-Fi', '净重': '4.4 kg' }],
  ['electric-kettle', '米家电水壶', 'kitchen', '厨房电器', 'electric-kettle', '1.5L 家用电水壶，适合日常烧水。', { '型号': 'MJDSH01YM', '容量': '1.5 L', '额定功率': '1800 W', '额定电压': '220 V / 50 Hz', '净重': '1.1 kg', '尺寸': '216 × 152 × 252 mm' }],
  ['smart-kettle', '米家恒温电水壶', 'kitchen', '厨房电器', 'kettle', '支持温度设置和保温的电水壶，通过蓝牙连接 App。', { '型号': 'YM-K1501', '容量': '1.5 L', '额定功率': '1800 W', '额定电压': '220 V / 50 Hz', '连接方式': '蓝牙 4.0 BLE', '净重': '1.24 kg' }, '历史参考价 ¥199（非现售价）'],
  ['induction-cooker', '米家电磁炉', 'kitchen', '厨房电器', 'induction-cooker', '2100W 电磁炉，使用时需要匹配适用锅具。', { '型号': 'DCL01CM', '额定功率': '2100 W', '额定电压': '220 V / 50 Hz', '能效等级': '3 级', '尺寸': '280 × 265 × 70 mm', '净重': '约 2.1 kg', '使用限制': '请勿直接放在金属台面上；使用符合说明书要求的锅具。' }],
  ['robot-vacuum', '米家扫地机器人', 'cleaning', '清洁电器', 'roomrobot', '支持智能路径规划、远程控制、自动回充和断点续扫。', { '电池': '14.4 V / 5200 mAh 锂电池', '额定功率': '55 W', '主机额定电压': '14.4 V', '尺寸': '345 × 345 × 96 mm', '重量': '约 3.8 kg', '连接方式': 'Wi-Fi', '使用限制': '按官方说明在 0–40℃ 环境下使用。' }],
  ['handheld-vacuum', '米家手持无线吸尘器', 'cleaning', '清洁电器', 'vacuum-cleaner', '无线手持吸尘器，配备地刷、床刷、缝隙吸头和毛刷。', { '型号': 'SCWXCQ01RR', '额定功率': '350 W', '额定电压': '21.6 V', '电池': '21.6 V / 2500 mAh（典型值）', '主机净重': '约 1.5 kg', '工作模式': '标准模式 / MAX 模式' }],
  ['desk-lamp-1s', '米家台灯 1S', 'lighting', '照明', 'mjsmartlamp-1s', '支持色温与亮度调节的桌面照明产品。', { '型号': 'MJTD01SYL', '光通量': '520 lm', '显色指数': 'Ra90', '色温范围': '2600–5000 K', '亮度范围': '1%–100%', '额定功率': '9 W', '连接方式': '2.4 GHz Wi-Fi' }],
  ['bedside-lamp-2', '米家床头灯 2', 'lighting', '照明', 'mj-bedsidelamp2', '支持 WRGB 调色、亮度调节及智能连接的床头灯。', { '型号': 'MJCTD02YL', '颜色调节': 'WRGB', '光通量': '480 lm（3500 K、最大亮度条件下）', '显色指数': 'Ra80', '额定功率': '9 W', '连接方式': '2.4 GHz Wi-Fi / 蓝牙 4.2 BLE' }, '历史活动价 ¥159（非现售价）'],
  ['motion-nightlight', '米家感应夜灯', 'lighting', '照明', 'nightlight', '人体红外与光感联动的小夜灯，适用于室内辅助照明。', { '型号': 'MJYD01YL', '色温': '2700 K', '亮度': '低档 0.7 lm / 高档 3.8 lm', '额定功率': '0.25 W', '感应器': '人体红外 + 光感', '电池': '三节 AA（5 号）电池', '使用限制': '仅限室内使用，不防水。' }, '历史参考价 ¥49（非现售价）'],
  ['camera-360-1080p', '小米智能摄像机云台版（1080p）', 'security', '家庭安防', 'camera-360', '1080p 家用云台摄像机，支持 Wi-Fi 连接和存储卡录像。', { '分辨率': '1080p', '镜头角度': '110°', '焦距': '3.9 mm', '电源输入': '5 V / 1 A', '连接方式': '2.4 GHz Wi-Fi', '存储': 'MicroSD，最大 32 GB，Class 10 及以上', '尺寸': '118 × 78 × 78 mm', '重量': '239 g' }],
  ['bluetooth-thermohygrometer', '米家蓝牙温湿度计', 'environment', '环境监测', 'mj-humiture', '使用 AAA 电池供电的温湿度显示设备。', { '型号': 'LYWSDCGQ/01ZM', '屏幕尺寸': '1.78 英寸', '温度量程': '−9.9℃～60℃', '湿度量程': '0～99.9%', '电池': '一节 AAA（7 号）电池', '尺寸': '60.8 × 60.8 × 22.5 mm', '重量': '43 g' }],
];

async function getText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Source returned ${response.status}: ${url}`);
  return response.text();
}

async function productImage(slug, html) {
  // Only inspect this product's stylesheet, not global navigation/product ads.
  const cssUrls = [...html.matchAll(/href=["']([^"']+\.css[^"']*)["']/g)]
    .map(match => new URL(match[1], `https://www.mi.com/${slug}/specs`).href)
    .filter(url => url.includes(`/product/${slug}/`));
  const candidates = [];
  for (const cssUrl of cssUrls) {
    const css = await getText(cssUrl);
    for (const match of css.matchAll(/url\(["']?([^)'"\s]+)["']?\)/g)) {
      if (/\.(jpg|jpeg|png|webp)(?:[?!]|$)/i.test(match[1])) candidates.push(new URL(match[1], cssUrl).href);
    }
  }
  for (const url of candidates) {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (response.ok && response.headers.get('content-type')?.startsWith('image/')) {
      await response.body?.cancel();
      return url;
    }
    await response.body?.cancel();
  }
  throw new Error(`No verified official product image for ${slug}`);
}

const products = [];
for (const [id, name, categoryId, category, slug, summary, specifications, suggestedPrice] of entries) {
  const sourceUrl = `https://www.mi.com/${slug}/specs`;
  const html = await getText(sourceUrl);
  const imageUrl = await productImage(slug, html);
  const specs = { ...specifications, '资料版本': '小米大陆官网所列型号；历史产品资料，不代表当前在售。' };
  if (suggestedPrice) specs['历史价格来源'] = priceSource;
  products.push({ id: `xiaomi-${id}`, brand: 'Xiaomi', name, categoryId, category, summary, sourceUrl, imageUrl, suggestedPrice: suggestedPrice ?? null, specifications: specs,
    description: `## 产品介绍\n\n${summary}\n\n## 核心规格\n\n${Object.entries(specifications).map(([key, value]) => `- ${key}：${value}`).join('\n')}\n\n## 资料说明\n\n参数来自[小米官方参数页](${sourceUrl})，请以准确型号和官方说明书为准。${suggestedPrice ? `\n\n${suggestedPrice}，来自[小米历史活动页](${priceSource})，不能作为当前报价。` : '\n\n暂无核实价格，当前售价请咨询官方销售渠道。'}` });
  console.log(`Prepared ${name} (official image verified)`);
}
assert.equal(products.length, 12);
assert.equal(new Set(products.map(item => item.id)).size, 12);
const pool = new Pool({ host: '127.0.0.1', port: Number(process.env.POSTGRES_PORT || 5433), user: process.env.POSTGRES_USER || 'grounded', password: process.env.POSTGRES_PASSWORD, database: process.env.POSTGRES_DB || 'grounded_support' });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('LOCK TABLE catalog_products IN SHARE ROW EXCLUSIVE MODE');
  const before = (await client.query('SELECT * FROM catalog_products ORDER BY display_order, id')).rows;
  const removed = before.filter(row => row.id === 'midea-hft20zbj' && row.brand === 'Midea' && row.name === '美的塔式暖风机 HFT20ZBJ');
  const existing = products.filter(item => before.some(row => row.id === item.id || row.name === item.name));
  if (existing.length) throw new Error(`Duplicate products; refusing to overwrite: ${existing.map(item => item.id).join(', ')}`);
  console.log(JSON.stringify({ importCount: products.length, deleteTargets: removed.map(row => ({ id: row.id, name: row.name })), existingRetained: before.length - removed.length }));
  if (!process.argv.includes('--apply')) {
    await client.query('ROLLBACK');
    console.log('Dry run only. Use --apply to persist.');
  } else {
    // Backup must succeed before any deletion. Contains catalog data only, no secrets.
    await mkdir('.data/catalog-backups', { recursive: true });
    const backup = `.data/catalog-backups/before-xiaomi-import-${Date.now()}.json`;
    await writeFile(backup, JSON.stringify(before, null, 2), { mode: 0o600, flag: 'wx' });
    const actor = (await client.query('SELECT id FROM admins ORDER BY id LIMIT 1')).rows[0];
    if (!actor) throw new Error('An admin record is required for the import audit.');
    const startOrder = Math.max(0, ...before.map(row => row.display_order)) + 1;
    for (const [index, item] of products.entries()) {
      await client.query(`INSERT INTO catalog_products (id,brand,name,category_id,category_name,summary,description,suggested_price,image_url,source_url,specifications,display_order,enabled) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,true)`, [item.id,item.brand,item.name,item.categoryId,item.category,item.summary,item.description,item.suggestedPrice,item.imageUrl,item.sourceUrl,JSON.stringify(item.specifications),startOrder+index]);
      await client.query(`INSERT INTO audit_logs (actor_admin_id,action,target_type,target_id,details) VALUES ($1,'product.created','catalog_product',$2,$3::jsonb)`, [actor.id,item.id,JSON.stringify({ name: item.name, via: 'user_authorized_catalog_import', sourceUrl: item.sourceUrl })]);
    }
    for (const row of removed) {
      await client.query('DELETE FROM catalog_products WHERE id=$1 AND brand=$2 AND name=$3', [row.id,row.brand,row.name]);
      await client.query(`INSERT INTO audit_logs (actor_admin_id,action,target_type,target_id,details) VALUES ($1,'product.deleted','catalog_product',$2,$3::jsonb)`, [actor.id,row.id,JSON.stringify({ via: 'user_authorized_catalog_import', backup })]);
    }
    assert.equal(Number((await client.query('SELECT count(*) FROM catalog_products')).rows[0].count), before.length + 12 - removed.length);
    await client.query('COMMIT');
    console.log(`Import committed. Recoverable catalog backup: ${backup}`);
  }
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
