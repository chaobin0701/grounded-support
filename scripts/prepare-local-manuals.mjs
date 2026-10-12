import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manualsDir = resolve(root, 'website/public/manuals');
mkdirSync(manualsDir, { recursive: true });

const manualTemplates = [
  {
    id: 'xiaomi-smart-kettle',
    name: '米家恒温电水壶',
    model: 'YM-K1501',
    summary: '1.5L 精准多档恒温调节，最长 12 小时智能保温，1800W 快速沸腾，支持米家 App 蓝牙智能互联。',
    specs: [
      ['额定容量', '1.5 L'], ['额定功率', '1800 W'],
      ['额定电压', '220 V ~ 50 Hz'], ['连接方式', '蓝牙 4.0 BLE'],
      ['保温范围', '40℃ - 90℃（最长12小时）'], ['内胆材质', '食品接触级 304 不锈钢'],
      ['净重', '1.24 kg'], ['外形尺寸', '204 × 145 × 235 mm']
    ],
    operations: [
      '【煮沸模式】：按下手柄内侧【煮沸】触控键，水壶以 1800W 全功率加热至 100℃ 沸腾后自动断电。',
      '【保温模式】：倒入纯净水后按下【保温】键，可直接加热至 App 设定的保温温度（如 50℃ 或 80℃）。',
      '【蓝牙配对】：长按【保温】键 3 秒，手柄处指示灯快闪，打开手机米家 App 靠近设备即可完成配对。'
    ],
    troubleshooting: [
      ['E01', '继电器开路/发热线路故障', '请断开底座电源，拔下插头静置 5 分钟后重试；若无法恢复请联系售后维修。'],
      ['E02', '温度传感器故障（NTC探头异常）', '底部 NTC 传感器开路或短路，请停止使用并送修。'],
      ['E04', '防干烧保护触发', '壶内无水误开机，立即拔掉插头并在室温下自然冷却 20 分钟后加水恢复。']
    ],
    maintenance: '长期使用产生水垢时，可按 1:2 比例倒入白醋与清水煮沸，断电静置 2~4 小时后彻底冲洗。'
  },
  {
    id: 'xiaomi-induction-cooker',
    name: '米家电磁炉',
    model: 'DCL01CM',
    summary: '99 档精准控温，双频火力与低温慢煮技术，外置感温探头直测锅底，OLED 旋钮屏幕直观操作。',
    specs: [
      ['额定功率', '2100 W'], ['额定电压', '220 V ~ 50 Hz'],
      ['火力档位', '99 档微调'], ['能效等级', '3 级'],
      ['适用锅具', '铁质/不锈钢导磁锅具 (直径 12-26cm)'], ['连接方式', '2.4GHz Wi-Fi'],
      ['净重', '约 2.1 kg'], ['外形尺寸', '280 × 265 × 70 mm']
    ],
    operations: [
      '【火力微调】：旋转中心旋钮调节 0~99 档火力；短按旋钮启动/暂停；长按 2 秒关机进入待机。',
      '【定时与功能】：点击【定时】键后转动旋钮设定时间；点击【功能】键循环切换火锅、蒸煮、煲汤等模式。',
      '【重置 Wi-Fi】：待机状态下，同时按住【定时】与【功能】按键 3 秒，Wi-Fi 图标闪烁即重置成功。'
    ],
    troubleshooting: [
      ['无锅报警', '未放置锅具或材质不匹配', '换用平底且底部直径大于 12cm 的铁质或复合导磁锅具。'],
      ['E01/E02', '感温探头异常/接触不良', '擦拭清理微晶面板中心外置探头四周油垢，确认回弹自如。'],
      ['E07/E08', '机内超温保护', '进出风口受阻积热，请清理底部防尘网并等待机器风扇散热后开机。']
    ],
    maintenance: '烹饪完毕待面板降至常温后，用柔软湿布蘸中性清洁剂擦拭；防滑硅胶圈可单独拆卸冲洗。'
  },
  {
    id: 'xiaomi-handheld-vacuum',
    name: '米家手持无线吸尘器',
    model: 'SCWXCQ01RR',
    summary: '9 锥气旋无损吸力，10 万转高速无刷数码电机，100AW 大吸力，标配 4 款多功能刷头深度除尘除螨。',
    specs: [
      ['额定功率', '350 W'], ['额定电压', '21.6 V'],
      ['最大吸入功率', '100 AW'], ['电池容量', '2500 mAh'],
      ['主机净重', '约 1.5 kg'], ['充电时间', '约 3.5 小时'],
      ['续航时间', '标准模式约 30 分钟 / MAX 模式约 6 分钟'], ['过滤等级', '99.97% 颗粒物过滤']
    ],
    operations: [
      '【开机清扫】：扣动扳机开关即启动，松开即停机；顶部设有【MAX】强效模式按键。',
      '【刷头更换】：对准卡扣直接推入接杆或刷头，听到咔嗒声即锁定；按压释放按钮即可拔出更换。',
      '【一键倒尘】：按压尘杯底部释放扣，底盖自动弹开即可单手清空积灰。'
    ],
    troubleshooting: [
      ['红灯闪烁停机', '风道堵塞或滚刷过载', '清理地刷滚轮缠绕的毛发，检查延长管内是否有大颗粒异物卡住。'],
      ['吸力明显下降', '滤网或尘杯积灰过多', '倾倒尘杯并清洗进风海绵滤网与后置 HEPA 滤芯。']
    ],
    maintenance: '滤芯组件水洗后必须放在通风阴凉处彻底晾干 24 小时以上方可装回，未干透装机会烧毁电机。'
  },
  {
    id: 'xiaomi-bedside-lamp-2',
    name: '米家床头灯 2',
    model: 'MJCTD02YL',
    summary: '晶莹通透全景光照无暗区，WRGB 全彩调光，最低低于 2 流明舒适夜灯，支持米家与 Apple HomeKit 双生态。',
    specs: [
      ['光通量', '480 lm（3500K 最大亮度）'], ['显色指数', 'Ra80'],
      ['色彩调节', 'WRGB 全彩 1600 万色'], ['色温范围', '1700 K – 6500 K'],
      ['额定功率', '9 W'], ['连接方式', 'Wi-Fi 2.4GHz + 蓝牙 4.2 BLE'],
      ['净重', '约 780 g'], ['外形尺寸', '140 × 140 × 200 mm']
    ],
    operations: [
      '【触控条交互】：短按顶部模式键切换彩光/白光；上下滑动触控条调节亮度；短按底部电源键开关。',
      '【恢复出厂设置】：开机状态下，同时按住顶部的【模式键】与底部的【电源键】5 秒，灯光开始红绿蓝交替流动，松手后变为白光即完成重置。'
    ],
    troubleshooting: [
      ['触控滑动不灵敏', '机身表面有水渍或静电', '拔掉电源静置 10 秒后重新插电，确保手指干燥洁净。'],
      ['无法连接家庭 App', 'Wi-Fi 频段不兼容', '请确保手机连接至 2.4GHz Wi-Fi 网络，并扫描底座 HomeKit 验证码。']
    ],
    maintenance: '使用干燥纯棉软布擦拭磨砂灯罩；请勿使用酒精或强腐蚀性有机溶剂清洗。'
  },
  {
    id: 'xiaomi-motion-nightlight',
    name: '米家感应夜灯',
    model: 'MJYD01YL',
    summary: '光敏 + 人体双重感应，120°超大感应角度，双档亮度自由切换，3 节 5 号电池超长 12 个月待机续航。',
    specs: [
      ['色温', '2700 K 暖黄光'], ['亮度档位', '低档 0.7 lm / 高档 3.8 lm'],
      ['感应角度', '120° 扇形'], ['感应距离', '正前方 5~7 米，侧方 2~3 米'],
      ['供电电池', '3 节 AA (5号) 碱性电池'], ['延时灭灯', '15 秒自动熄灭'],
      ['外形尺寸', '直径 84 × 厚度 36 mm'], ['净重', '141 g（含电池）']
    ],
    operations: [
      '【调节亮度档位】：顺时针旋转拆开后盖，电池仓侧边带有高低两档切换开关。',
      '【粘贴安装】：撕开 3M 胶保护膜，贴于光滑洁净墙面，或利用背部挂绳悬挂于衣柜挂杆。'
    ],
    troubleshooting: [
      ['白天经过不亮', '光敏保护生效', '属正常省电设计，在环境光线充足时夜灯会自动休眠不点亮。'],
      ['感应频繁误触发', '安装位置靠近热源', '避免安装在空调出风口、暖风机正面或强光直射反光处。']
    ],
    maintenance: '长期外出不用时建议取出电池，防止老旧电池漏液腐蚀内部触点。'
  },
  {
    id: 'xiaomi-camera-360-1080p',
    name: '小米智能摄像机云台版（1080p）',
    model: 'MJSXJ05CM',
    summary: '360°全景水平巡航视界，1080p 高清画质与微光全彩夜视，AI 人形侦测报警，支持双向实时通话。',
    specs: [
      ['视频分辨率', '1920 × 1080 (1080p)'], ['镜头光圈', 'F2.1 大光圈'],
      ['水平视角', '360° 全景水平旋转'], ['垂直视角', '96° 垂直俯仰'],
      ['视频编码', 'H.265'], ['本地存储', 'MicroSD 卡（最大 64GB，Class 10）'],
      ['供电输入', '5 V / 1 A (Micro-USB)'], ['连接方式', 'Wi-Fi IEEE 802.11 b/g/n 2.4GHz']
    ],
    operations: [
      '【开机与指示灯】：接通电源黄灯常亮；黄灯闪烁等待配网；蓝灯闪烁正在联网；蓝灯常亮工作正常。',
      '【重置摄像机】：向上推起摄像头镜头露出卡槽，长按卡槽旁的【RESET 重置孔】3 秒至语音提示“重置成功”。',
      '【存储卡安装】：在断电状态下推起镜头，将 MicroSD 卡金属面朝下平稳推入卡槽直到卡紧。'
    ],
    troubleshooting: [
      ['存储卡无法录像', '卡未格式化或卡速不足', '进入米家 App 设置中对存储卡进行 FAT32 格式化，确保卡速为 Class 10 正品卡。'],
      ['双向通话产生啸叫', '声反馈共振', '手机通话端与摄像机处于同一封闭房间距离过近，拉开距离即可消除。']
    ],
    maintenance: '定期使用镜头擦拭纸清理光学镜片灰尘；请勿在潮湿或户外露雨环境中使用。'
  },
  {
    id: 'xiaomi-bluetooth-thermohygrometer',
    name: '米家蓝牙温湿度计',
    model: 'LYWSDCGQ/01ZM',
    summary: '内置瑞士 Sensirion 工业级高精度温湿度传感器，1.78 英寸大 LCD 屏幕，低功耗 1 节电池长续航一年。',
    specs: [
      ['屏幕尺寸', '1.78 英寸 LCD'], ['供电电池', '1 节 AAA (7号) 碱性电池'],
      ['温度量程', '-9.9℃ ～ 60.0℃ (误差 ±0.3℃)'], ['湿度量程', '0% ～ 99.9% RH (误差 ±3%)'],
      ['连接方式', '蓝牙 4.0 BLE'], ['外形尺寸', '60.8 × 60.8 × 22.5 mm'],
      ['净重', '43 g'], ['固定方式', '磁吸吸附 / 墙贴支架']
    ],
    operations: [
      '【开机使用】：拉出电池绝缘拉条，屏幕显现即开机；磁吸贴附在墙贴支架上。',
      '【配网连接】：打开手机蓝牙与米家 App，靠近设备自动发现并绑定，联动蓝牙网关可实现全屋智能控温控湿。'
    ],
    troubleshooting: [
      ['屏幕字体变淡消失', '电池电量耗尽', '扣开后盖更换一节全新 7 号碱性电池。'],
      ['App 无法同步实时数据', '超出蓝牙有效距离', '未配置蓝牙网关时需手机靠近设备（10米内）读取离线记录。']
    ],
    maintenance: '避免将传感器进气通孔泡水或沾染油烟污渍。'
  },
  {
    id: 'xiaomi-electric-warmer',
    name: '米家电暖器',
    model: 'KRDNQ01ZM',
    summary: '对流式高效静音制暖无风感，2200W 强劲升温，IPX4 防溅水居浴两用，倾倒断电双重安全保护。',
    specs: [
      ['额定功率', '2200 W (高档) / 1500 W (中档)'], ['额定电压', '220 V ~ 50 Hz'],
      ['适用面积', '10 – 20 ㎡'], ['防水等级', 'IPX4 级防溅水'],
      ['控制方式', '机身触控 + 米家 App + 智能语音'], ['净重', '约 5.3 kg'],
      ['外形尺寸', '780 × 526 × 216 mm'], ['连接方式', '2.4GHz Wi-Fi']
    ],
    operations: [
      '【开关机与温控】：轻触电源键开机；通过面板【+ / -】设定目标温度（18℃~28℃）；支持 1/3/5/9 小时定时关机。',
      '【重置 Wi-Fi】：开机状态下，长按机身侧边【Wi-Fi/灯光键】5 秒，听到滴声指示灯快闪即进入配网模式。'
    ],
    troubleshooting: [
      ['开机自动跳闸停机', '机器倾斜或地面不平', '内置机械防倾倒开关触发，必须将机器放置在平整硬地面上使用。'],
      ['机体发烫超温报警', '出风栅格被遮盖', '严禁在电暖器顶部覆盖衣物或毛巾阻挡热对流，清理后冷却 20 分钟重新开机。']
    ],
    maintenance: '换季收纳前拔掉插头，待整机冷却后用干软布擦净表面灰尘，放入防尘罩中干燥保存。'
  },
  {
    id: 'xiaomi-fresh-air-ventilator',
    name: '米家新风机',
    model: 'MJXFJ-300-G1',
    summary: '300m³/h 超大新风量，全屋微正压换气阻隔脏空气，三层复合过滤除甲醛降 CO2，PTC 辅助电加热防冷风。',
    specs: [
      ['额定新风量', '300 m³/h'], ['辅热功率', '800 W'],
      ['额定总功率', '842 W'], ['适用面积', '≤ 105 ㎡'],
      ['最大噪声', '≤ 36 dB(A)（睡眠档低至 20.4 dB）'], ['传感器', '激光颗粒物传感器 + 高敏红外 CO2 传感器'],
      ['滤芯配置', '防蚊初效网 + Merv12中效芯 + H13高效芯'], ['净重', '约 16 kg']
    ],
    operations: [
      '【触控操作】：OLED 屏幕上轻按开关键开关机；轻按模式键切换自动、睡眠、最强档及辅热开/关。',
      '【重置 Wi-Fi】：长按屏幕下方的【开关/模式触控键】7 秒，屏幕出现 Wi-Fi 闪烁图标即重置网络。'
    ],
    troubleshooting: [
      ['屏幕报错 E01', '传感器检测风道积灰', '断电后使用小毛刷或干棉签清洁机身右侧 PM2.5 与 CO2 检测孔。'],
      ['进风量明显变小', '滤芯严重脏污堵塞', '取出底层防蚊初效滤网水洗晾干，若中高效滤芯寿命归零请及时更换新滤芯。']
    ],
    maintenance: '初效滤网建议每 1~4 周清水清洗晾干；中高效滤芯寿命到期后换新并在开机状态长按复位键 6 秒。'
  }
];

function buildHtml(item) {
  const specsRows = item.specs.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('');
  const opItems = item.operations.map(op => `<li>${op}</li>`).join('');
  const tbRows = item.troubleshooting.map(([code, cause, sol]) => `<tr><td><strong>${code}</strong></td><td>${cause}</td><td>${sol}</td></tr>`).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @page { size: A4; margin: 18mm 20mm; }
  body { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; color: #1e293b; line-height: 1.6; font-size: 13px; }
  .header { border-bottom: 2.5px solid #0f766e; padding-bottom: 14px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-end; }
  .title-group h1 { font-size: 22px; margin: 0 0 6px 0; color: #0f766e; font-weight: 700; }
  .title-group p { font-size: 13px; color: #64748b; margin: 0; }
  .badge { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 600; white-space: nowrap; }
  h2 { font-size: 15px; margin: 18px 0 8px; color: #334155; border-left: 3.5px solid #0f766e; padding-left: 8px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 14px; font-size: 12.5px; }
  th, td { border: 1px solid #e2e8f0; padding: 7px 10px; text-align: left; }
  th { background: #f8fafc; font-weight: 600; color: #475569; width: 28%; }
  ul { padding-left: 20px; margin: 6px 0 12px; }
  li { margin-bottom: 5px; }
  .tb-table th { width: auto; }
  .tb-table th:first-child { width: 22%; }
  .tb-table th:nth-child(2) { width: 34%; }
  .warning-box { background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 10px 14px; margin: 14px 0; font-size: 12px; color: #92400e; }
  .footer { margin-top: 24px; border-top: 1px dashed #cbd5e1; padding-top: 10px; font-size: 11px; color: #94a3b8; text-align: center; }
</style>
</head>
<body>
<div class="header">
  <div class="title-group">
    <h1>${item.name}</h1>
    <p>电子使用与维护指南 · 官方服务技术手册</p>
  </div>
  <div class="badge">产品型号：${item.model}</div>
</div>

<h2>一、产品概述</h2>
<p>${item.summary}</p>

<h2>二、核心技术规格</h2>
<table>
  ${specsRows}
</table>

<h2>三、快速操作与配网指南</h2>
<ul>
  ${opItems}
</ul>

<h2>四、故障代码表与排查</h2>
<table class="tb-table">
  <thead><tr><th>代码 / 现象</th><th>可能原因</th><th>排除解决办法</th></tr></thead>
  <tbody>
    ${tbRows}
  </tbody>
</table>

<h2>五、日常维护与安全须知</h2>
<p>${item.maintenance}</p>
<div class="warning-box">
  <strong>安全警示：</strong>请在额定电压下使用本设备；严禁私自拆卸或改装内部强电回路与高压元器件；如电源软线损坏，必须使用专用组件或联系官方客服更换。
</div>

<div class="footer">
  本说明书电子文档由禾序智能客户服务中心归档提供 · 遵照国家家用电器三包售后标准执行
</div>
</body>
</html>`;
}

for (const item of manualTemplates) {
  const targetPdf = resolve(manualsDir, `${item.id}.pdf`);
  if (existsSync(targetPdf)) {
    console.log(`[manual] ${item.id}.pdf already exists, skipping.`);
    continue;
  }
  const tempHtml = resolve(root, `.data/${item.id}.html`);
  writeFileSync(tempHtml, buildHtml(item), 'utf8');
  console.log(`[manual] generating ${item.id}.pdf via Chrome headless...`);
  try {
    execSync(`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu --print-to-pdf="${targetPdf}" "${tempHtml}"`, { stdio: 'ignore' });
    console.log(`[manual] created ${item.id}.pdf successfully.`);
  } catch (err) {
    console.error(`[manual] failed to generate ${item.id}.pdf:`, err.message);
  }
}

console.log('All product manuals generated.');
