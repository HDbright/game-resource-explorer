// ============ 数据状态层(分类 / 动画条目 / 场景 CRUD) ============

/** 设置默认值(合并到已保存设置,保证旧库缺字段时也能补齐) */
export const DEFAULT_SETTINGS = {
  playMode: 'loop',
  timeScale: 1,
  bgColor: '#22242b',
  showBones: false,
  lastCategoryId: 'all',
  lastItemId: null,
  zoomMode: '100', // 'fit' 适配窗口 | '100' 固定100% | 'fixed' 跟随缩放滑块数值
  resourceTab: 'home', // 'anim' | 'image' | 'audio' | '3d' | 'home'
  listViewMode: 'list', // 'detail' | 'list' | 'icon'
  listSortBy: 'name', // 'name' | 'type' | 'size' | 'date'
  listSortDir: 'asc', // 'asc' | 'desc'
  // 标签页
  openSameTypeNewTab: true, // 打开同类型资源时是否新开标签页(true=每个资源独立标签; false=同类型复用/替换当前预览标签)
  // 截图设置
  screenshotPath: '', // 默认保存目录(空 = 用图片库目录/Spine截图)
  screenshotFormat: 'png', // 'png' | 'webp'
  screenshotQuality: 0.92, // webp 质量 0~1
  screenshotAddToLibrary: true, // 截图后是否加入「图片资源」指定分类
  screenshotCategory: 'spine截图', // 目标图片分类名(不存在则自动创建)
  // 音频播放器
  audioMode: 'single', // 'single'单次 | 'loop'单曲循环 | 'dirOrder'目录顺序 | 'dirLoop'目录循环 | 'listOrder'列表顺序 | 'listLoop'列表循环
  audioRate: 1, // 变速 0.5~2
  audioPlaylists: [], // 播放列表 [{id, name, paths: [filePath...]}]
  audioCurrentListId: null, // 当前播放列表 id
  // 最近打开(首页展示): [{name, path, type, tab, itemId, openedAt}] 最新在前,上限 20
  recentOpens: [],
  // FGUI 预览画布背景色
  fguiBgColor: '#1b1d23',
  // 自定义背景色(动画/图片/FGUI 背景色条共用,「保存」按钮写入)
  customBgColor: '#3a4150',
  audioListFields: { // 播放列表条目显示字段(在设置页配置)
    fileName: true, // 文件名
    title: true, // 标题(ID3)
    artist: true, // 艺术家(ID3)
    album: false, // 专辑(ID3)
    duration: true, // 时长
  },
  // 网络资源抓取
  webGameLastUrl: '', // 上次打开的游戏 URL(自动回填)
  webGameSaveDir: '', // 抓取资源输出目录
  webGameProxy: '', // 可选代理(如 http://127.0.0.1:7890)
  webGameHistory: [], // 最近打开的游戏 [{url, title, openedAt}] 最新在前,上限 20
  webgameAutoFloatOnSwitch: false, // 从网页浏览器切到其它模块时,是否自动把网页弹出独立悬浮窗(true=自动浮出; false=仅隐藏,回抓取页仍可见)
  // 外观:主题 / 字体字号 / 背景
  theme: 'dark', // 'dark' | 'light' | 'custom' | 'system'(跟随系统)
  fontScale: 1, // 全局字体/界面缩放(作用于 #app 的 zoom,1 = 100%)
  // 各主题独立配置(强调色 / 背景色 / 前景色 / 背景图),互不共享
  themes: {
    dark:   { accent: '', bgColor: '', fgColor: '', bgImage: '', bgImageOn: false, panelBg: '', menuBg: '', btnBg: '', hoverBg: '', borderColor: '' },
    light:  { accent: '', bgColor: '', fgColor: '', bgImage: '', bgImageOn: false, panelBg: '', menuBg: '', btnBg: '', hoverBg: '', borderColor: '' },
    custom: { accent: '', bgColor: '', fgColor: '', bgImage: '', bgImageOn: false, panelBg: '', menuBg: '', btnBg: '', hoverBg: '', borderColor: '' },
  },
  // 图标库(节点图标选择面板):自定义分组 + 图标(emoji 或 PNG dataURL)
  iconGroups: [], // [{ id, name, sort }]
  iconItems: [], // [{ id, groupId, name, icon, sort }] icon: emoji 或 data:image/... dataURL
  // 系统设置页卡片:顺序 + 自定义标题/图标
  settingCardOrder: [], // 卡片 id 数组(按用户拖拽顺序)
  settingCardMeta: {}, // { [cardId]: { title, icon } }
  // 自定义页面(终端节点「目标页面」可基于模板建立并管理)
  customPages: [], // [{ id, templateId, title, icon, url, content, note, createdAt, updatedAt }]
  // 自定义资源类型(如「图标资源」.png/.ico;扩展名优先于内置匹配,归属某资源分组)
  customTypes: [], // [{ id, name, group, exts: ['.png'], icon }]
  // 自定义资源分组(如 图标/数据/文件;分组自带扩展名,扫描时归 type=<分组id>,并作为分类标签/目录可选项)
  customTypeGroups: [], // [{ id, name, icon, exts }]
};

/** 默认图标库(首次启动无自定义数据时 seed;分组/图标可增删改序) */
export const DEFAULT_ICON_LIBRARY = [
  { group: "笑脸与情感", items: ["😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "🙃", "😉", "😊", "😇", "🥰", "😍", "🤩", "😘", "😗", "😚", "😙", "🥲", "😋", "😛", "😜", "🤪", "😝", "🤑", "🤗", "🤭", "🤫", "🤔", "🤐", "🤨", "😐", "😑", "😶", "😏", "😒", "🙄", "😬", "🤥", "😌", "😔", "😪", "🤤", "😴", "😷", "🤒", "🤕", "🤢", "🤮", "🤧", "🥵", "🥶", "🥴", "😵", "🤯", "🤠", "🥳", "🥸", "😎", "🤓", "🧐", "😕", "😟", "🙁", "☹️", "😮", "😯", "😲", "😳", "😨", "😰", "😥", "😢", "😭", "😱", "😠", "😡", "🤬", "🤡", "👹", "👺", "👻", "💀", "☠️", "🎃", "😺", "😸", "😻", "🙈", "🙉", "🙊", "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💔", "❤️‍🔥", "❤️‍🩹", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "💋", "💌", "💐"] },
  { group: "人物与身体", items: ["👋", "🤚", "✋", "🖐️", "🖖", "👌", "🤌", "🤏", "✌️", "🤞", "🤟", "🤘", "👈", "👉", "👆", "👇", "☝️", "👍", "👎", "✊", "👊", "🤛", "🤜", "👏", "👐", "🤲", "🙏", "💅", "💪", "🦾", "👮", "🕵️", "💂", "👷", "🧑‍🌾", "👨‍🍳", "👩‍🔬", "🧑‍💻", "👨‍🎤", "👩‍🎨", "🧑‍✈️", "👨‍🚀", "👩‍⚕️", "🧑‍🏫", "👨‍⚖️", "🤴", "👸", "🤵", "👰", "🥷", "🧙", "🧝", "🧛", "🧟", "🧞", "🏃", "🚶", "🧎", "🧍", "🙆", "🙅", "💁", "🙋", "🤷", "🤦", "🤸", "⛹️", "🏋️", "🤼", "🏌️", "🎿", "🏂", "🏊", "🏄", "🚣", "🚴", "🛹", "🪂", "💃", "🕺", "🕴️", "👨‍👩‍👧", "👨‍👩‍👧‍👦", "👩‍👩‍👧", "👨‍👨‍👦", "👫", "👭", "👬", "💏", "💑", "👀", "👁️", "👃", "👄", "👅", "🦷", "🦴", "👂", "🦻", "🦶", "🦵", "🦿", "🫀", "🫁", "🧠", "🩸"] },
  { group: "动物与自然", items: ["🐶", "🐕", "🐩", "🐺", "🦊", "🐱", "🐈", "🦁", "🐯", "🐅", "🐆", "🐴", "🐎", "🦄", "🦓", "🦌", "🐮", "🐂", "🐃", "🐷", "🐖", "🐗", "🐑", "🐐", "🐪", "🐫", "🦙", "🦒", "🐘", "🦣", "🦏", "🦛", "🐭", "🐁", "🐀", "🐹", "🐰", "🐇", "🦔", "🦨", "🦡", "🐨", "🐼", "🦥", "🦦", "🦝", "🐻", "🐻‍❄️", "🐔", "🐓", "🐣", "🐤", "🦆", "🦢", "🦅", "🦉", "🦩", "🦚", "🦜", "🐦", "🐧", "🕊️", "🐸", "🐊", "🐢", "🦎", "🐍", "🐉", "🐲", "🦕", "🦖", "🐳", "🐋", "🐬", "🦭", "🐟", "🐠", "🐡", "🦈", "🐙", "🦀", "🦞", "🦐", "🦑", "🐚", "🪸", "🐌", "🦋", "🐛", "🐜", "🐝", "🐞", "🕷️", "🕸️", "🦂", "🦟", "🪰", "🪱", "🦠", "💮", "🌸", "🌹", "🥀", "🌺", "🌻", "🌼", "🌷", "🌱", "🌿", "☘️", "🍀", "🍁", "🍂", "🍃", "🌵", "🌴", "🌲", "🌳", "🌰", "🪨", "🪵", "☀️", "🌤️", "⛅", "🌥️", "☁️", "🌦️", "🌧️", "⛈️", "🌩️", "🌨️", "❄️", "☃️", "⛄", "🌬️", "💨", "🌪️", "🌫️", "🌈", "🌊", "💧", "💦", "⚡", "🔥", "💫", "✨", "⭐", "🌟", "🌙", "🌝", "🌞", "🌍", "🌎", "🌏", "🌐"] },
  { group: "食物与饮料", items: ["🍎", "🍏", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🍑", "🍒", "🥭", "🍍", "🥥", "🥝", "🍅", "🫐", "🥬", "🥦", "🥒", "🥕", "🌽", "🫑", "🌶️", "🧄", "🧅", "🥔", "🍠", "🥗", "🫘", "🫛", "🍞", "🥐", "🥖", "🥨", "🥯", "🧀", "🥚", "🍳", "🥓", "🥩", "🍗", "🍖", "🌭", "🍔", "🍟", "🍕", "🥪", "🥙", "🌮", "🌯", "🍝", "🍜", "🍲", "🍛", "🍚", "🍙", "🍘", "🍡", "🥟", "🥠", "🥡", "🍦", "🍧", "🍨", "🍩", "🍪", "🎂", "🍰", "🧁", "🥧", "🍫", "🍬", "🍭", "🍮", "🍯", "🥤", "🧋", "🍵", "☕", "🫖", "🍺", "🍻", "🥂", "🍷", "🍸", "🍹", "🥃", "🧃", "🥛", "🍽️", "🍴", "🥄", "🥢", "🍶", "🏺"] },
  { group: "旅行与地点", items: ["🗺️", "🗾", "🏔️", "⛰️", "🗻", "🏕️", "🏖️", "🏜️", "🏝️", "🌋", "🏠", "🏡", "🏘️", "🏚️", "🏗️", "🏢", "🏬", "🏦", "🏥", "🏫", "⛪", "🕌", "🛕", "🕍", "⛩️", "🏛️", "🏰", "🗼", "🗽", "💒", "🚗", "🚕", "🚙", "🚐", "🚚", "🚛", "🚌", "🚎", "🚋", "🚞", "🚂", "🚄", "🚆", "🚇", "🚈", "🚲", "🛵", "🏍️", "🦽", "🛴", "🚢", "⛴️", "🚤", "🛶", "🚀", "✈️", "🛩️", "🚁", "🎈", "🪁", "🕐", "🕑", "🕒", "🕓", "🕔", "🕕", "🕖", "🕗", "🕘", "🕙", "🕚", "🕛", "🕜", "🕝", "🕞", "🕟", "🕠", "🕡", "🕢", "🕣", "🕤", "🕥", "🕦", "🕧", "⏰", "🕰️", "⏱️", "⏲️", "⌛", "⏳", "📅", "📆", "🗓️", "⛵", "🛰", "🛸"] },
  { group: "活动", items: ["⚽", "🏀", "🏈", "⚾", "🎾", "🏐", "🏉", "🥏", "🎱", "🏓", "🏸", "🏒", "🏑", "🏏", "🪃", "🥅", "⛳", "🎣", "🤿", "🥊", "🥋", "🎽", "🎮", "🕹️", "🎰", "🎲", "♟️", "🧩", "🪀", "🎵", "🎶", "🎼", "🎤", "🎧", "🎷", "🎸", "🎹", "🥁", "🎺", "🎻", "🪗", "🎨", "🖼️", "🎭", "🎬", "🎉", "🎊", "🎁", "🎀", "🏆", "🥇", "🥈", "🥉", "🏅", "🎖️", "🏵️", "🎗️", "🎞", "📽", "🪕", "🎪", "🎫", "🎟", "🎯", "🎳", "⛸", "🧧", "🛍", "🛒", "🪄", "🎆", "🎇", "🧸", "🎄", "🎋", "🏮"] },
  { group: "物品", items: ["👕", "👖", "👔", "👗", "👘", "🥻", "🧥", "🧣", "🧤", "🧦", "👟", "👠", "👡", "🥿", "👢", "🎩", "🧢", "👒", "🎓", "👑", "💍", "💎", "📿", "👜", "👝", "🎒", "👓", "🕶️", "🥽", "📱", "📲", "☎️", "📞", "📟", "💻", "🖥️", "🖨️", "⌨️", "🖱️", "🖲️", "💽", "💾", "💿", "📀", "📼", "📷", "📸", "📹", "🎥", "📺", "📻", "🎙️", "🔊", "🔉", "🔈", "🔇", "🔋", "🔌", "💡", "🔦", "🪔", "🕯️", "📄", "📃", "📑", "📊", "📈", "📉", "📋", "📌", "📎", "🖇️", "✂️", "🗃️", "🗄️", "🗑️", "✏️", "✒️", "🖊️", "🖋️", "🖌️", "🖍️", "📝", "📓", "📔", "📒", "📕", "📖", "📗", "📘", "📙", "📚", "🔖", "💰", "💴", "💵", "💶", "💷", "💸", "💳", "🧾", "💹", "✉️", "📧", "📨", "📩", "📤", "📥", "📦", "📫", "📬", "🔧", "🔨", "⚒️", "🛠️", "⛏️", "🔩", "🪓", "🧰", "🪑", "🚪", "🛋️", "🛏️", "🧺", "🧻", "🧼", "🧽", "🪣", "🧹", "💊", "💉", "🩹", "🩺", "⚕️", "🧬", "🔬", "⚗️", "🧪", "🧫", "📁", "📂", "🗂", "📍", "🗒", "📇", "📪", "📭", "📮", "🏷", "⚙", "🪛", "🪚", "🧲", "⚓", "🛡", "🔍", "🔎", "🎛", "🎚", "📡", "🔭", "🧱", "🧊", "🧭"] },
  { group: "符号", items: ["🚦", "🚥", "🛑", "🚧", "⚠️", "🚸", "🛗", "➡️", "⬅️", "⬆️", "⬇️", "↗️", "↘️", "↙️", "↖️", "↕️", "↔️", "🔄", "🔃", "🔙", "🔚", "🔛", "🔜", "🔝", "✝️", "☦️", "☪️", "🕉️", "✡️", "☸️", "♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "♐", "♑", "♒", "♓", "🔴", "🟠", "🟡", "🟢", "🔵", "🟣", "⚫", "⚪", "🟤", "🔺", "🔻", "🔸", "🔹", "🔶", "🔷", "◾", "◽", "⬛", "⬜", "▪️", "▫️", "♾️", "✖️", "➕", "➖", "➗", "〰️", "❗", "❓", "❕", "❔", "💯", "✅", "❌", "⭕", "✳️", "✴️", "❇️", "💢", "💬", "💭", "🗨️", "🗯️", "💤", "💈", "🎏", "🎐", "🧿", "♻️", "🔱", "⚜️", "📛", "🔞", "0️⃣", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟", "#️⃣", "*️⃣", "ℹ️", "🆗", "🆕", "🆙", "🆒", "🆓", "🆖", "🎦", "📶"] },
  { group: "旗帜", items: ["🇨🇳", "🇺🇸", "🇯🇵", "🇰🇷", "🇬🇧", "🇫🇷", "🇩🇪", "🇮🇹", "🇪🇸", "🇷🇺", "🇧🇷", "🇮🇳", "🇨🇦", "🇦🇺", "🏳️", "🏴", "🏁", "🚩", "🏳️‍🌈", "🏴‍☠️", "🎌"] },
  { group: "组件", items: ["🏻", "🏼", "🏽", "🏾", "🏿", "🦰", "🦱", "🦲", "🦳"] },
];

/**
 * 默认 emoji 的中英文名称(key 为去掉 U+FE0F 变体选择符后的基础字符,seed 时按此归一化匹配)
 */
export const EMOJI_NAMES = {
  "😀": "咧嘴笑脸 / Grinning Face",
  "😃": "大眼咧嘴笑脸 / Grinning Face with Big Eyes",
  "😄": "笑眼咧嘴笑脸 / Grinning Face with Smiling Eyes",
  "😁": "喜笑颜开脸 / Beaming Face with Smiling Eyes",
  "😆": "眯眼笑 / Grinning Squinting Face",
  "😅": "苦笑冒汗 / Grinning Face with Sweat",
  "🤣": "笑到打滚 / Rolling on the Floor Laughing",
  "😂": "笑哭 / Face with Tears of Joy",
  "🙂": "微笑脸 / Slightly Smiling Face",
  "🙃": "倒脸 / Upside-Down Face",
  "😉": "眨眼脸 / Winking Face",
  "😊": "笑眼微笑 / Smiling Face with Smiling Eyes",
  "😇": "天使微笑 / Smiling Face with Halo",
  "🥰": "爱心微笑 / Smiling Face with Hearts",
  "😍": "爱心眼 / Smiling Face with Heart-Eyes",
  "🤩": "星星眼 / Star-Struck",
  "😘": "飞吻 / Face Blowing a Kiss",
  "😗": "亲亲脸 / Kissing Face",
  "😚": "闭眼亲亲 / Kissing Face with Closed Eyes",
  "😙": "笑眼亲亲 / Kissing Face with Smiling Eyes",
  "🥲": "含泪微笑 / Smiling Face with Tear",
  "😋": "馋嘴脸 / Face Savoring Food",
  "😛": "吐舌脸 / Face with Tongue",
  "😜": "眨眼吐舌 / Winking Face with Tongue",
  "🤪": "滑稽脸 / Zany Face",
  "😝": "眯眼吐舌 / Squinting Face with Tongue",
  "🤑": "发财脸 / Money-Mouth Face",
  "🤗": "拥抱脸 / Hugging Face",
  "🤭": "捂嘴笑 / Face with Hand Over Mouth",
  "🤫": "嘘声脸 / Shushing Face",
  "🤔": "思考脸 / Thinking Face",
  "🤐": "拉链嘴 / Zipper-Mouth Face",
  "🤨": "挑眉脸 / Face with Raised Eyebrow",
  "😐": "面无表情 / Neutral Face",
  "😑": "无语脸 / Expressionless Face",
  "😶": "无嘴脸 / Face Without Mouth",
  "😏": "得意笑 / Smirking Face",
  "😒": "不爽脸 / Unamused Face",
  "🙄": "翻白眼 / Face with Rolling Eyes",
  "😬": "龇牙脸 / Grimacing Face",
  "🤥": "说谎脸 / Lying Face",
  "😌": "松口气 / Relieved Face",
  "😔": "沉思脸 / Pensive Face",
  "😪": "困脸 / Sleepy Face",
  "🤤": "流口水 / Drooling Face",
  "😴": "睡觉脸 / Sleeping Face",
  "😷": "口罩脸 / Face with Medical Mask",
  "🤒": "发烧脸 / Face with Thermometer",
  "🤕": "受伤脸 / Face with Head-Bandage",
  "🤢": "恶心脸 / Nauseated Face",
  "🤮": "呕吐脸 / Face Vomiting",
  "🤧": "打喷嚏 / Sneezing Face",
  "🥵": "热脸 / Hot Face",
  "🥶": "冷脸 / Cold Face",
  "🥴": "醉脸 / Woozy Face",
  "😵": "晕脸 / Knocked-Out Face",
  "🤯": "爆炸头 / Exploding Head",
  "🤠": "牛仔帽脸 / Cowboy Hat Face",
  "🥳": "派对脸 / Partying Face",
  "🥸": "伪装脸 / Disguised Face",
  "😎": "墨镜脸 / Smiling Face with Sunglasses",
  "🤓": "书呆子脸 / Nerd Face",
  "🧐": "单片眼镜 / Face with Monocle",
  "😕": "困惑脸 / Confused Face",
  "😟": "担忧脸 / Worried Face",
  "🙁": "微皱眉 / Slightly Frowning Face",
  "☹️": "皱眉脸 / Frowning Face",
  "😮": "张嘴惊讶 / Face with Open Mouth",
  "😯": "缄默惊讶 / Hushed Face",
  "😲": "震惊脸 / Astonished Face",
  "😳": "脸红脸 / Flushed Face",
  "😨": "害怕脸 / Fearful Face",
  "😰": "冷汗焦虑 / Anxious Face with Sweat",
  "😥": "失望释然 / Sad but Relieved Face",
  "😢": "哭泣脸 / Crying Face",
  "😭": "嚎啕大哭 / Loudly Crying Face",
  "😱": "尖叫恐惧 / Face Screaming in Fear",
  "😠": "生气脸 / Angry Face",
  "😡": "暴怒脸 / Pouting Face",
  "🤬": "咒骂脸 / Face with Symbols on Mouth",
  "🤡": "小丑脸 / Clown Face",
  "👹": "食人魔 / Ogre",
  "👺": "天狗 / Goblin",
  "👻": "幽灵 / Ghost",
  "💀": "骷髅 / Skull",
  "☠️": "骷髅交叉骨 / Skull and Crossbones",
  "🎃": "南瓜灯 / Jack-O-Lantern",
  "😺": "笑猫脸 / Grinning Cat",
  "😸": "笑眼猫 / Grinning Cat with Smiling Eyes",
  "😻": "爱心眼猫 / Smiling Cat with Heart-Eyes",
  "🙈": "非礼勿视 / See-No-Evil Monkey",
  "🙉": "非礼勿听 / Hear-No-Evil Monkey",
  "🙊": "非礼勿言 / Speak-No-Evil Monkey",
  "❤️": "红心 / Red Heart",
  "🧡": "橙心 / Orange Heart",
  "💛": "黄心 / Yellow Heart",
  "💚": "绿心 / Green Heart",
  "💙": "蓝心 / Blue Heart",
  "💜": "紫心 / Purple Heart",
  "🖤": "黑心 / Black Heart",
  "🤍": "白心 / White Heart",
  "💔": "心碎 / Broken Heart",
  "❤️‍🔥": "烈火之心 / Heart on Fire",
  "❤️‍🩹": "修复之心 / Mending Heart",
  "💕": "两颗心 / Two Hearts",
  "💞": "旋转爱心 / Revolving Hearts",
  "💓": "跳动的心 / Beating Heart",
  "💗": "成长的心 / Growing Heart",
  "💖": "闪亮爱心 / Sparkling Heart",
  "💘": "丘比特之心 / Heart with Arrow",
  "💝": "礼物爱心 / Heart with Ribbon",
  "💋": "唇印 / Kiss Mark",
  "💌": "情书 / Love Letter",
  "💐": "花束 / Bouquet",
  "👋": "挥手 / Waving Hand",
  "🤚": "抬手 / Raised Back of Hand",
  "✋": "手掌 / Raised Hand",
  "🖐️": "五指张开 / Hand with Fingers Splayed",
  "🖖": "瓦肯举手礼 / Vulcan Salute",
  "👌": "OK手势 / OK Hand",
  "🤌": "捏手指 / Pinched Fingers",
  "🤏": "捏一捏 / Pinching Hand",
  "✌️": "胜利手势 / Victory Hand",
  "🤞": "交叉手指 / Crossed Fingers",
  "🤟": "我爱你手势 / Love-You Gesture",
  "🤘": "摇滚手势 / Sign of the Horns",
  "👈": "左指 / Backhand Index Pointing Left",
  "👉": "右指 / Backhand Index Pointing Right",
  "👆": "上指 / Backhand Index Pointing Up",
  "👇": "下指 / Backhand Index Pointing Down",
  "☝️": "食指向上 / Index Pointing Up",
  "👍": "点赞 / Thumbs Up",
  "👎": "踩 / Thumbs Down",
  "✊": "拳头 / Raised Fist",
  "👊": "出拳 / Oncoming Fist",
  "🤛": "左拳 / Left-Facing Fist",
  "🤜": "右拳 / Right-Facing Fist",
  "👏": "鼓掌 / Clapping Hands",
  "👐": "张开双手 / Open Hands",
  "🤲": "掌心向上 / Palms Up Together",
  "🙏": "双手合十 / Folded Hands",
  "💅": "涂指甲 / Nail Polish",
  "💪": "肌肉 / Flexed Biceps",
  "🦾": "机械臂 / Mechanical Arm",
  "👮": "警察 / Police Officer",
  "🕵️": "侦探 / Detective",
  "💂": "卫兵 / Guard",
  "👷": "建筑工人 / Construction Worker",
  "🧑‍🌾": "农民 / Farmer",
  "👨‍🍳": "厨师 / Cook",
  "👩‍🔬": "科学家 / Scientist",
  "🧑‍💻": "程序员 / Technologist",
  "👨‍🎤": "歌手 / Singer",
  "👩‍🎨": "艺术家 / Artist",
  "🧑‍✈️": "飞行员 / Pilot",
  "👨‍🚀": "宇航员 / Astronaut",
  "👩‍⚕️": "医生 / Health Worker",
  "🧑‍🏫": "教师 / Teacher",
  "👨‍⚖️": "法官 / Judge",
  "🤴": "王子 / Prince",
  "👸": "公主 / Princess",
  "🤵": "穿礼服的人 / Person in Tuxedo",
  "👰": "披头纱的人 / Person with Veil",
  "🥷": "忍者 / Ninja",
  "🧙": "法师 / Mage",
  "🧝": "精灵 / Elf",
  "🧛": "吸血鬼 / Vampire",
  "🧟": "僵尸 / Zombie",
  "🧞": "精灵 / Genie",
  "🏃": "跑步者 / Person Running",
  "🚶": "行人 / Person Walking",
  "🧎": "跪姿 / Person Kneeling",
  "🧍": "站立者 / Person Standing",
  "🙆": "举手OK / Person Gesturing OK",
  "🙅": "拒绝手势 / Person Gesturing No",
  "💁": "咨询台 / Person Tipping Hand",
  "🙋": "举手 / Person Raising Hand",
  "🤷": "耸肩 / Person Shrugging",
  "🤦": "捂脸 / Person Facepalming",
  "🤸": "侧手翻 / Person Cartwheeling",
  "⛹️": "打篮球 / Person Bouncing Ball",
  "🏋️": "举重 / Person Lifting Weights",
  "🤼": "摔跤 / Wrestlers",
  "🏌️": "打高尔夫 / Person Golfing",
  "🎿": "滑雪 / Skier",
  "🏂": "单板滑雪 / Snowboarder",
  "🏊": "游泳 / Swimmer",
  "🏄": "冲浪 / Person Surfing",
  "🚣": "划船 / Person Rowing Boat",
  "🚴": "骑自行车 / Person Biking",
  "🛹": "滑板 / Skateboarder",
  "🪂": "跳伞 / Parachute",
  "💃": "跳舞女人 / Woman Dancing",
  "🕺": "跳舞男人 / Man Dancing",
  "🕴️": "悬浮西装 / Man in Suit Levitating",
  "👨‍👩‍👧": "一家三口 / Family: Man, Woman, Girl",
  "👨‍👩‍👧‍👦": "一家四口 / Family: Man, Woman, Girl, Boy",
  "👩‍👩‍👧": "女同家庭 / Family: Woman, Woman, Girl",
  "👨‍👨‍👦": "男同家庭 / Family: Man, Man, Boy",
  "👫": "男女牵手 / Woman and Man Holding Hands",
  "👭": "女女牵手 / Two Women Holding Hands",
  "👬": "男男牵手 / Two Men Holding Hands",
  "💏": "亲吻 / Kiss",
  "💑": "情侣 / Couple with Heart",
  "👀": "双眼 / Eyes",
  "👁️": "单眼 / Eye",
  "👃": "鼻子 / Nose",
  "👄": "嘴 / Mouth",
  "👅": "舌头 / Tongue",
  "🦷": "牙齿 / Tooth",
  "🦴": "骨头 / Bone",
  "👂": "耳朵 / Ear",
  "🦻": "助听器 / Ear with Hearing Aid",
  "🦶": "脚 / Foot",
  "🦵": "腿 / Leg",
  "🦿": "机械腿 / Mechanical Leg",
  "🫀": "心脏 / Anatomical Heart",
  "🫁": "肺 / Lungs",
  "🧠": "大脑 / Brain",
  "🩸": "血滴 / Drop of Blood",
  "🐶": "狗脸 / Dog Face",
  "🐕": "狗 / Dog",
  "🐩": "贵宾犬 / Poodle",
  "🐺": "狼 / Wolf",
  "🦊": "狐狸 / Fox",
  "🐱": "猫脸 / Cat Face",
  "🐈": "猫 / Cat",
  "🦁": "狮子 / Lion",
  "🐯": "老虎脸 / Tiger Face",
  "🐅": "老虎 / Tiger",
  "🐆": "豹子 / Leopard",
  "🐴": "马头 / Horse Face",
  "🐎": "马 / Horse",
  "🦄": "独角兽 / Unicorn",
  "🦓": "斑马 / Zebra",
  "🦌": "鹿 / Deer",
  "🐮": "牛脸 / Cow Face",
  "🐂": "公牛 / Ox",
  "🐃": "水牛 / Water Buffalo",
  "🐷": "猪脸 / Pig Face",
  "🐖": "猪 / Pig",
  "🐗": "野猪 / Boar",
  "🐑": "绵羊 / Ewe",
  "🐐": "山羊 / Goat",
  "🐪": "单峰驼 / Camel",
  "🐫": "双峰驼 / Two-Hump Camel",
  "🦙": "羊驼 / Llama",
  "🦒": "长颈鹿 / Giraffe",
  "🐘": "大象 / Elephant",
  "🦣": "猛犸象 / Mammoth",
  "🦏": "犀牛 / Rhinoceros",
  "🦛": "河马 / Hippopotamus",
  "🐭": "老鼠脸 / Mouse Face",
  "🐁": "老鼠 / Mouse",
  "🐀": "大鼠 / Rat",
  "🐹": "仓鼠 / Hamster",
  "🐰": "兔子脸 / Rabbit Face",
  "🐇": "兔子 / Rabbit",
  "🦔": "刺猬 / Hedgehog",
  "🦨": "臭鼬 / Skunk",
  "🦡": "獾 / Badger",
  "🐨": "考拉 / Koala",
  "🐼": "熊猫 / Panda",
  "🦥": "树懒 / Sloth",
  "🦦": "水獭 / Otter",
  "🦝": "浣熊 / Raccoon",
  "🐻": "熊 / Bear",
  "🐻‍❄️": "北极熊 / Polar Bear",
  "🐔": "鸡 / Chicken",
  "🐓": "公鸡 / Rooster",
  "🐣": "破壳小鸡 / Hatching Chick",
  "🐤": "小鸡 / Baby Chick",
  "🦆": "鸭子 / Duck",
  "🦢": "天鹅 / Swan",
  "🦅": "鹰 / Eagle",
  "🦉": "猫头鹰 / Owl",
  "🦩": "火烈鸟 / Flamingo",
  "🦚": "孔雀 / Peacock",
  "🦜": "鹦鹉 / Parrot",
  "🐦": "鸟 / Bird",
  "🐧": "企鹅 / Penguin",
  "🕊️": "鸽子 / Dove",
  "🐸": "青蛙 / Frog",
  "🐊": "鳄鱼 / Crocodile",
  "🐢": "乌龟 / Turtle",
  "🦎": "蜥蜴 / Lizard",
  "🐍": "蛇 / Snake",
  "🐉": "龙 / Dragon",
  "🐲": "龙头 / Dragon Face",
  "🦕": "长颈龙 / Sauropod",
  "🦖": "霸王龙 / T-Rex",
  "🐳": "喷水鲸 / Spouting Whale",
  "🐋": "鲸鱼 / Whale",
  "🐬": "海豚 / Dolphin",
  "🦭": "海豹 / Seal",
  "🐟": "鱼 / Fish",
  "🐠": "热带鱼 / Tropical Fish",
  "🐡": "河豚 / Blowfish",
  "🦈": "鲨鱼 / Shark",
  "🐙": "章鱼 / Octopus",
  "🦀": "螃蟹 / Crab",
  "🦞": "龙虾 / Lobster",
  "🦐": "虾 / Shrimp",
  "🦑": "鱿鱼 / Squid",
  "🐚": "贝壳 / Spiral Shell",
  "🪸": "珊瑚 / Coral",
  "🐌": "蜗牛 / Snail",
  "🦋": "蝴蝶 / Butterfly",
  "🐛": "毛毛虫 / Caterpillar",
  "🐜": "蚂蚁 / Ant",
  "🐝": "蜜蜂 / Honeybee",
  "🐞": "瓢虫 / Lady Beetle",
  "🕷️": "蜘蛛 / Spider",
  "🕸️": "蜘蛛网 / Spider Web",
  "🦂": "蝎子 / Scorpion",
  "🦟": "蚊子 / Mosquito",
  "🪰": "苍蝇 / Fly",
  "🪱": "蠕虫 / Worm",
  "🦠": "微生物 / Microbe",
  "💮": "白花 / White Flower",
  "🌸": "樱花 / Cherry Blossom",
  "🌹": "玫瑰 / Rose",
  "🥀": "枯萎的花 / Wilted Flower",
  "🌺": "扶桑花 / Hibiscus",
  "🌻": "向日葵 / Sunflower",
  "🌼": "雏菊 / Blossom",
  "🌷": "郁金香 / Tulip",
  "🌱": "幼苗 / Seedling",
  "🌿": "香草 / Herb",
  "☘️": "三叶草 / Shamrock",
  "🍀": "四叶草 / Four Leaf Clover",
  "🍁": "枫叶 / Maple Leaf",
  "🍂": "落叶 / Fallen Leaf",
  "🍃": "飘叶 / Leaf Fluttering in Wind",
  "🌵": "仙人掌 / Cactus",
  "🌴": "棕榈树 / Palm Tree",
  "🌲": "松树 / Evergreen Tree",
  "🌳": "落叶树 / Deciduous Tree",
  "🌰": "栗子 / Chestnut",
  "🪨": "岩石 / Rock",
  "🪵": "木头 / Wood",
  "☀️": "太阳 / Sun",
  "🌤️": "晴转多云 / Sun Behind Small Cloud",
  "⛅": "多云转晴 / Sun Behind Cloud",
  "🌥️": "多云 / Sun Behind Large Cloud",
  "☁️": "云 / Cloud",
  "🌦️": "晴转雨 / Sun Behind Rain Cloud",
  "🌧️": "下雨 / Cloud with Rain",
  "⛈️": "雷暴 / Cloud with Lightning and Rain",
  "🌩️": "打雷 / Cloud with Lightning",
  "🌨️": "下雪 / Cloud with Snow",
  "❄️": "雪花 / Snowflake",
  "☃️": "雪人 / Snowman",
  "⛄": "无帽雪人 / Snowman Without Snow",
  "🌬️": "大风 / Wind Face",
  "💨": "尾气 / Dashing Away",
  "🌪️": "龙卷风 / Tornado",
  "🌫️": "雾 / Fog",
  "🌈": "彩虹 / Rainbow",
  "🌊": "浪花 / Water Wave",
  "💧": "水滴 / Droplet",
  "💦": "汗滴 / Sweat Droplets",
  "⚡": "闪电 / High Voltage",
  "🔥": "火焰 / Fire",
  "💫": "眩晕 / Dizzy",
  "✨": "闪烁 / Sparkles",
  "⭐": "星星 / Star",
  "🌟": "闪亮星星 / Glowing Star",
  "🌙": "弯月 / Crescent Moon",
  "🌝": "笑满月 / Full Moon Face",
  "🌞": "笑太阳 / Sun with Face",
  "🌍": "地球欧洲非洲 / Globe Showing Europe-Africa",
  "🌎": "地球美洲 / Globe Showing Americas",
  "🌏": "地球亚洲澳洲 / Globe Showing Asia-Australia",
  "🌐": "经纬地球 / Globe with Meridians",
  "🍎": "红苹果 / Red Apple",
  "🍏": "青苹果 / Green Apple",
  "🍐": "梨 / Pear",
  "🍊": "橘子 / Tangerine",
  "🍋": "柠檬 / Lemon",
  "🍌": "香蕉 / Banana",
  "🍉": "西瓜 / Watermelon",
  "🍇": "葡萄 / Grapes",
  "🍓": "草莓 / Strawberry",
  "🍑": "桃子 / Peach",
  "🍒": "樱桃 / Cherries",
  "🥭": "芒果 / Mango",
  "🍍": "菠萝 / Pineapple",
  "🥥": "椰子 / Coconut",
  "🥝": "猕猴桃 / Kiwi Fruit",
  "🍅": "番茄 / Tomato",
  "🫐": "蓝莓 / Blueberries",
  "🥬": "绿叶菜 / Leafy Green",
  "🥦": "西兰花 / Broccoli",
  "🥒": "黄瓜 / Cucumber",
  "🥕": "胡萝卜 / Carrot",
  "🌽": "玉米 / Ear of Corn",
  "🫑": "甜椒 / Bell Pepper",
  "🌶️": "辣椒 / Hot Pepper",
  "🧄": "大蒜 / Garlic",
  "🧅": "洋葱 / Onion",
  "🥔": "土豆 / Potato",
  "🍠": "红薯 / Roasted Sweet Potato",
  "🥗": "沙拉 / Green Salad",
  "🫘": "豆子 / Beans",
  "🫛": "豌豆 / Pea Pod",
  "🍞": "面包 / Bread",
  "🥐": "可颂 / Croissant",
  "🥖": "法棍 / Baguette Bread",
  "🥨": "椒盐卷饼 / Pretzel",
  "🥯": "贝果 / Bagel",
  "🧀": "奶酪 / Cheese Wedge",
  "🥚": "鸡蛋 / Egg",
  "🍳": "煎蛋 / Cooking",
  "🥓": "培根 / Bacon",
  "🥩": "牛排 / Cut of Meat",
  "🍗": "鸡腿 / Poultry Leg",
  "🍖": "排骨 / Meat on Bone",
  "🌭": "热狗 / Hot Dog",
  "🍔": "汉堡 / Hamburger",
  "🍟": "薯条 / French Fries",
  "🍕": "披萨 / Pizza",
  "🥪": "三明治 / Sandwich",
  "🥙": "皮塔饼 / Stuffed Flatbread",
  "🌮": "墨西哥卷 / Taco",
  "🌯": "墨西哥卷饼 / Burrito",
  "🍝": "意面 / Spaghetti",
  "🍜": "拉面 / Steaming Bowl",
  "🍲": "炖菜 / Pot of Food",
  "🍛": "咖喱饭 / Curry Rice",
  "🍚": "米饭 / Cooked Rice",
  "🍙": "饭团 / Rice Ball",
  "🍘": "米饼 / Rice Cracker",
  "🍡": "团子 / Dango",
  "🥟": "饺子 / Dumpling",
  "🥠": "幸运饼干 / Fortune Cookie",
  "🥡": "外卖盒 / Takeout Box",
  "🍦": "甜筒 / Soft Ice Cream",
  "🍧": "刨冰 / Shaved Ice",
  "🍨": "冰淇淋 / Ice Cream",
  "🍩": "甜甜圈 / Doughnut",
  "🍪": "曲奇 / Cookie",
  "🎂": "生日蛋糕 / Birthday Cake",
  "🍰": "蛋糕片 / Shortcake",
  "🧁": "纸杯蛋糕 / Cupcake",
  "🥧": "派 / Pie",
  "🍫": "巧克力 / Chocolate Bar",
  "🍬": "糖果 / Candy",
  "🍭": "棒棒糖 / Lollipop",
  "🍮": "布丁 / Custard",
  "🍯": "蜂蜜 / Honey Pot",
  "🥤": "带吸管杯 / Cup with Straw",
  "🧋": "珍珠奶茶 / Bubble Tea",
  "🍵": "热茶 / Teacup Without Handle",
  "☕": "咖啡 / Hot Beverage",
  "🫖": "茶壶 / Teapot",
  "🍺": "啤酒 / Beer Mug",
  "🍻": "碰杯 / Clinking Beer Mugs",
  "🥂": "香槟碰杯 / Clinking Glasses",
  "🍷": "红酒 / Wine Glass",
  "🍸": "鸡尾酒 / Cocktail Glass",
  "🍹": "热带饮料 / Tropical Drink",
  "🥃": "威士忌 / Tumbler Glass",
  "🧃": "果汁盒 / Beverage Box",
  "🥛": "牛奶 / Glass of Milk",
  "🍽️": "餐具 / Fork and Knife with Plate",
  "🍴": "刀叉 / Fork and Knife",
  "🥄": "勺子 / Spoon",
  "🥢": "筷子 / Chopsticks",
  "🍶": "清酒 / Sake",
  "🏺": "陶罐 / Amphora",
  "🗺️": "世界地图 / World Map",
  "🗾": "日本地图 / Map of Japan",
  "🏔️": "雪山 / Snow-Capped Mountain",
  "⛰️": "山 / Mountain",
  "🗻": "富士山 / Mount Fuji",
  "🏕️": "露营 / Camping",
  "🏖️": "海滩 / Beach with Umbrella",
  "🏜️": "沙漠 / Desert",
  "🏝️": "小岛 / Desert Island",
  "🌋": "火山 / Volcano",
  "🏠": "房子 / House",
  "🏡": "带花园的房子 / House with Garden",
  "🏘️": "住宅区 / Houses",
  "🏚️": "废墟 / Derelict House",
  "🏗️": "施工 / Building Construction",
  "🏢": "办公楼 / Office Building",
  "🏬": "百货商店 / Department Store",
  "🏦": "银行 / Bank",
  "🏥": "医院 / Hospital",
  "🏫": "学校 / School",
  "⛪": "教堂 / Church",
  "🕌": "清真寺 / Mosque",
  "🛕": "印度教寺庙 / Hindu Temple",
  "🕍": "犹太教堂 / Synagogue",
  "⛩️": "神社 / Shinto Shrine",
  "🏛️": "古典建筑 / Classical Building",
  "🏰": "城堡 / Castle",
  "🗼": "东京塔 / Tokyo Tower",
  "🗽": "自由女神像 / Statue of Liberty",
  "💒": "婚礼教堂 / Wedding",
  "🚗": "汽车 / Car",
  "🚕": "出租车 / Taxi",
  "🚙": "越野车 / Sport Utility Vehicle",
  "🚐": "房车 / Camper",
  "🚚": "卡车 / Delivery Truck",
  "🚛": "半挂车 / Articulated Lorry",
  "🚌": "公交车 / Bus",
  "🚎": "电车 / Trolleybus",
  "🚋": "有轨电车 / Tram",
  "🚞": "登山火车 / Mountain Railway",
  "🚂": "蒸汽火车 / Locomotive",
  "🚄": "高铁 / High-Speed Train",
  "🚆": "火车 / Train",
  "🚇": "地铁 / Metro",
  "🚈": "轻轨 / Light Rail",
  "🚲": "自行车 / Bicycle",
  "🛵": "踏板车 / Motor Scooter",
  "🏍️": "摩托车 / Motorcycle",
  "🦽": "轮椅 / Manual Wheelchair",
  "🛴": "滑板车 / Kick Scooter",
  "🚢": "轮船 / Ship",
  "⛴️": "渡轮 / Ferry",
  "🚤": "快艇 / Speedboat",
  "🛶": "独木舟 / Canoe",
  "🚀": "火箭 / Rocket",
  "✈️": "飞机 / Airplane",
  "🛩️": "小飞机 / Small Airplane",
  "🚁": "直升机 / Helicopter",
  "🎈": "气球 / Balloon",
  "🪁": "风筝 / Kite",
  "🕐": "一点钟 / One O’Clock",
  "🕑": "两点钟 / Two O’Clock",
  "🕒": "三点钟 / Three O’Clock",
  "🕓": "四点钟 / Four O’Clock",
  "🕔": "五点钟 / Five O’Clock",
  "🕕": "六点钟 / Six O’Clock",
  "🕖": "七点钟 / Seven O’Clock",
  "🕗": "八点钟 / Eight O’Clock",
  "🕘": "九点钟 / Nine O’Clock",
  "🕙": "十点钟 / Ten O’Clock",
  "🕚": "十一点钟 / Eleven O’Clock",
  "🕛": "十二点钟 / Twelve O’Clock",
  "🕜": "一点半 / One-Thirty",
  "🕝": "两点半 / Two-Thirty",
  "🕞": "三点半 / Three-Thirty",
  "🕟": "四点半 / Four-Thirty",
  "🕠": "五点半 / Five-Thirty",
  "🕡": "六点半 / Six-Thirty",
  "🕢": "七点半 / Seven-Thirty",
  "🕣": "八点半 / Eight-Thirty",
  "🕤": "九点半 / Nine-Thirty",
  "🕥": "十点半 / Ten-Thirty",
  "🕦": "十一点半 / Eleven-Thirty",
  "🕧": "十二点半 / Twelve-Thirty",
  "⏰": "闹钟 / Alarm Clock",
  "🕰️": "座钟 / Mantelpiece Clock",
  "⏱️": "秒表 / Stopwatch",
  "⏲️": "计时器 / Timer Clock",
  "⌛": "沙漏 / Hourglass Done",
  "⏳": "流动沙漏 / Hourglass Not Done",
  "📅": "日历 / Calendar",
  "📆": "日程本 / Tear-Off Calendar",
  "🗓️": "线圈日历 / Spiral Calendar",
  "⛵": "帆船 / Sailboat",
  "🛰": "卫星 / Satellite",
  "🛸": "飞碟 / Flying Saucer",
  "⚽": "足球 / Soccer Ball",
  "🏀": "篮球 / Basketball",
  "🏈": "美式橄榄球 / American Football",
  "⚾": "棒球 / Baseball",
  "🎾": "网球 / Tennis",
  "🏐": "排球 / Volleyball",
  "🏉": "橄榄球 / Rugby Football",
  "🥏": "飞盘 / Flying Disc",
  "🎱": "台球 / Pool 8 Ball",
  "🏓": "乒乓球 / Ping Pong",
  "🏸": "羽毛球 / Badminton",
  "🏒": "冰球 / Ice Hockey",
  "🏑": "曲棍球 / Field Hockey",
  "🏏": "板球 / Cricket Game",
  "🪃": "回旋镖 / Boomerang",
  "🥅": "球门 / Goal Net",
  "⛳": "高尔夫 / Flag in Hole",
  "🎣": "钓鱼竿 / Fishing Pole",
  "🤿": "潜水面罩 / Diving Mask",
  "🥊": "拳击手套 / Boxing Glove",
  "🥋": "柔道服 / Martial Arts Uniform",
  "🎽": "运动衫 / Running Shirt",
  "🎮": "游戏手柄 / Video Game",
  "🕹️": "摇杆 / Joystick",
  "🎰": "老虎机 / Slot Machine",
  "🎲": "骰子 / Game Die",
  "♟️": "国际象棋兵 / Chess Pawn",
  "🧩": "拼图 / Puzzle Piece",
  "🪀": "悠悠球 / Yo-Yo",
  "🎵": "音符 / Musical Note",
  "🎶": "多音符 / Multiple Musical Notes",
  "🎼": "乐谱 / Musical Score",
  "🎤": "麦克风 / Microphone",
  "🎧": "耳机 / Headphone",
  "🎷": "萨克斯 / Saxophone",
  "🎸": "吉他 / Guitar",
  "🎹": "钢琴 / Musical Keyboard",
  "🥁": "鼓 / Drum",
  "🎺": "小号 / Trumpet",
  "🎻": "小提琴 / Violin",
  "🪗": "手风琴 / Accordion",
  "🎨": "调色盘 / Artist Palette",
  "🖼️": "画框 / Framed Picture",
  "🎭": "戏剧面具 / Performing Arts",
  "🎬": "场记板 / Clapper Board",
  "🎉": "庆祝 / Party Popper",
  "🎊": "彩带 / Confetti Ball",
  "🎁": "礼物 / Gift",
  "🎀": "蝴蝶结 / Ribbon",
  "🏆": "奖杯 / Trophy",
  "🥇": "金牌 / 1st Place Medal",
  "🥈": "银牌 / 2nd Place Medal",
  "🥉": "铜牌 / 3rd Place Medal",
  "🏅": "奖牌 / Sports Medal",
  "🎖️": "军功章 / Military Medal",
  "🏵️": "花饰 / Rosette",
  "🎗️": "丝带 / Reminder Ribbon",
  "🎞": "胶片 / Film Frames",
  "📽": "放映机 / Film Projector",
  "🪕": "班卓琴 / Banjo",
  "🎪": "马戏团 / Circus Tent",
  "🎫": "门票 / Admission Tickets",
  "🎟": "票根 / Admission Tickets",
  "🎯": "靶心 / Direct Hit",
  "🎳": "保龄球 / Bowling",
  "⛸": "溜冰鞋 / Ice Skate",
  "🧧": "红包 / Red Envelope",
  "🛍": "购物袋 / Shopping Bags",
  "🛒": "购物车 / Shopping Cart",
  "🪄": "魔法棒 / Magic Wand",
  "🎆": "烟花 / Fireworks",
  "🎇": "烟花棒 / Sparkler",
  "🧸": "泰迪熊 / Teddy Bear",
  "🎄": "圣诞树 / Christmas Tree",
  "🎋": "竹子 / Tanabata Tree",
  "🏮": "灯笼 / Red Paper Lantern",
  "👕": "T恤 / T-Shirt",
  "👖": "牛仔裤 / Jeans",
  "👔": "领带 / Necktie",
  "👗": "连衣裙 / Dress",
  "👘": "和服 / Kimono",
  "🥻": "纱丽 / Sari",
  "🧥": "外套 / Coat",
  "🧣": "围巾 / Scarf",
  "🧤": "手套 / Gloves",
  "🧦": "袜子 / Socks",
  "👟": "运动鞋 / Running Shoe",
  "👠": "高跟鞋 / High-Heeled Shoe",
  "👡": "凉鞋 / Woman’s Sandal",
  "🥿": "拖鞋 / Flat Shoe",
  "👢": "靴子 / Woman’s Boot",
  "🎩": "礼帽 / Top Hat",
  "🧢": "棒球帽 / Billed Cap",
  "👒": "女帽 / Woman’s Hat",
  "🎓": "学士帽 / Graduation Cap",
  "👑": "皇冠 / Crown",
  "💍": "戒指 / Ring",
  "💎": "钻石 / Gem Stone",
  "📿": "念珠 / Prayer Beads",
  "👜": "手提包 / Handbag",
  "👝": "零钱包 / Clutch Bag",
  "🎒": "背包 / Backpack",
  "👓": "眼镜 / Glasses",
  "🕶️": "墨镜 / Sunglasses",
  "🥽": "护目镜 / Goggles",
  "📱": "手机 / Mobile Phone",
  "📲": "来电 / Mobile Phone with Arrow",
  "☎️": "座机 / Telephone",
  "📞": "电话听筒 / Telephone Receiver",
  "📟": "寻呼机 / Pager",
  "💻": "笔记本电脑 / Laptop",
  "🖥️": "台式电脑 / Desktop Computer",
  "🖨️": "打印机 / Printer",
  "⌨️": "键盘 / Keyboard",
  "🖱️": "鼠标 / Computer Mouse",
  "🖲️": "轨迹球 / Trackball",
  "💽": "光盘 / Computer Disk",
  "💾": "软盘 / Floppy Disk",
  "💿": "CD / Optical Disk",
  "📀": "DVD / DVD",
  "📼": "录像带 / Videocassette",
  "📷": "相机 / Camera",
  "📸": "拍照 / Camera with Flash",
  "📹": "摄像机 / Video Camera",
  "🎥": "电影摄影机 / Movie Camera",
  "📺": "电视 / Television",
  "📻": "收音机 / Radio",
  "🎙️": "录音麦 / Studio Microphone",
  "🔊": "喇叭 / Speaker High Volume",
  "🔉": "中音量 / Speaker Medium Volume",
  "🔈": "低音量 / Speaker Low Volume",
  "🔇": "静音 / Muted Speaker",
  "🔋": "电池 / Battery",
  "🔌": "插头 / Electric Plug",
  "💡": "灯泡 / Light Bulb",
  "🔦": "手电筒 / Flashlight",
  "🪔": "油灯 / Diya Lamp",
  "🕯️": "蜡烛 / Candle",
  "📄": "文件 / Page Facing Up",
  "📃": "带纹文件 / Page with Curl",
  "📑": "标签页 / Tabs",
  "📊": "柱状图 / Bar Chart",
  "📈": "上升趋势图 / Chart Increasing",
  "📉": "下降趋势图 / Chart Decreasing",
  "📋": "剪贴板 / Clipboard",
  "📌": "图钉 / Pushpin",
  "📎": "回形针 / Paperclip",
  "🖇️": "装订夹 / Linked Paperclips",
  "✂️": "剪刀 / Scissors",
  "🗃️": "卡片盒 / Card File Box",
  "🗄️": "文件柜 / File Cabinet",
  "🗑️": "垃圾桶 / Wastebasket",
  "✏️": "铅笔 / Pencil",
  "✒️": "钢笔 / Fountain Pen",
  "🖊️": "圆珠笔 / Pen",
  "🖋️": "蘸水笔 / Fountain Pen (alt)",
  "🖌️": "画笔 / Paintbrush",
  "🖍️": "蜡笔 / Crayon",
  "📝": "备忘录 / Memo",
  "📓": "笔记本 / Notebook",
  "📔": "带装饰笔记本 / Notebook with Decorative Cover",
  "📒": "账本 / Ledger",
  "📕": "红皮书 / Closed Book",
  "📖": "打开的书 / Open Book",
  "📗": "绿皮书 / Green Book",
  "📘": "蓝皮书 / Blue Book",
  "📙": "橙皮书 / Orange Book",
  "📚": "书堆 / Books",
  "🔖": "书签 / Bookmark",
  "💰": "钱袋 / Money Bag",
  "💴": "日元 / Yen Banknote",
  "💵": "美元 / Dollar Banknote",
  "💶": "欧元 / Euro Banknote",
  "💷": "英镑 / Pound Banknote",
  "💸": "长翅膀的钱 / Money with Wings",
  "💳": "信用卡 / Credit Card",
  "🧾": "收据 / Receipt",
  "💹": "货币升值 / Currency Exchange",
  "✉️": "信封 / Envelope",
  "📧": "电子邮件 / E-Mail",
  "📨": "来信 / Incoming Envelope",
  "📩": "收信 / Envelope with Arrow",
  "📤": "发件箱 / Outbox Tray",
  "📥": "收件箱 / Inbox Tray",
  "📦": "包裹 / Package",
  "📫": "关闭邮箱 / Closed Mailbox with Raised Flag",
  "📬": "打开邮箱 / Open Mailbox with Raised Flag",
  "🔧": "扳手 / Wrench",
  "🔨": "锤子 / Hammer",
  "⚒️": "铁锤 / Hammer and Pick",
  "🛠️": "工具套装 / Hammer and Wrench",
  "⛏️": "镐 / Pick",
  "🔩": "螺母螺栓 / Nut and Bolt",
  "🪓": "斧头 / Axe",
  "🧰": "工具箱 / Toolbox",
  "🪑": "椅子 / Chair",
  "🚪": "门 / Door",
  "🛋️": "沙发 / Couch and Lamp",
  "🛏️": "床 / Bed",
  "🧺": "篮子 / Basket",
  "🧻": "卷纸 / Roll of Paper",
  "🧼": "肥皂 / Soap",
  "🧽": "海绵 / Sponge",
  "🪣": "水桶 / Bucket",
  "🧹": "扫帚 / Broom",
  "💊": "药丸 / Pill",
  "💉": "针管 / Syringe",
  "🩹": "创可贴 / Adhesive Bandage",
  "🩺": "听诊器 / Stethoscope",
  "⚕️": "医学符号 / Medical Symbol",
  "🧬": "DNA / DNA",
  "🔬": "显微镜 / Microscope",
  "⚗️": "蒸馏器 / Alembic",
  "🧪": "试管 / Test Tube",
  "🧫": "培养皿 / Petri Dish",
  "📁": "文件夹 / File Folder",
  "📂": "打开文件夹 / Open File Folder",
  "🗂": "卡片索引 / Card Index Dividers",
  "📍": "定位图钉 / Round Pushpin",
  "🗒": "便签本 / Spiral Notepad",
  "📇": "名片索引 / Card Index",
  "📪": "关闭邮箱 / Closed Mailbox with Lowered Flag",
  "📭": "空邮箱 / Open Mailbox with Lowered Flag",
  "📮": "邮筒 / Postbox",
  "🏷": "标签 / Label",
  "⚙": "齿轮 / Gear",
  "🪛": "螺丝刀 / Screwdriver",
  "🪚": "手锯 / Saw",
  "🧲": "磁铁 / Magnet",
  "⚓": "锚 / Anchor",
  "🛡": "盾牌 / Shield",
  "🔍": "放大镜左 / Magnifying Glass Tilted Left",
  "🔎": "放大镜右 / Magnifying Glass Tilted Right",
  "🎛": "控制台 / Control Knobs",
  "🎚": "音量滑块 / Level Slider",
  "📡": "天线 / Satellite Antenna",
  "🔭": "望远镜 / Telescope",
  "🧱": "砖块 / Brick",
  "🧊": "冰块 / Ice",
  "🧭": "指南针 / Compass",
  "🚦": "红绿灯 / Vertical Traffic Light",
  "🚥": "横向红绿灯 / Horizontal Traffic Light",
  "🛑": "停止标志 / Stop Sign",
  "🚧": "施工标志 / Construction",
  "⚠️": "警告 / Warning",
  "🚸": "儿童过街 / Children Crossing",
  "🛗": "电梯 / Elevator",
  "➡️": "右箭头 / Right Arrow",
  "⬅️": "左箭头 / Left Arrow",
  "⬆️": "上箭头 / Up Arrow",
  "⬇️": "下箭头 / Down Arrow",
  "↗️": "右上箭头 / Up-Right Arrow",
  "↘️": "右下箭头 / Down-Right Arrow",
  "↙️": "左下箭头 / Down-Left Arrow",
  "↖️": "左上箭头 / Up-Left Arrow",
  "↕️": "上下箭头 / Up-Down Arrow",
  "↔️": "左右箭头 / Left-Right Arrow",
  "🔄": "顺时针箭头 / Clockwise Vertical Arrows",
  "🔃": "逆时针箭头 / Clockwise Arrows Button",
  "🔙": "返回 / Back Arrow",
  "🔚": "结束 / End Arrow",
  "🔛": "开启 / On! Arrow",
  "🔜": "即将到来 / Soon Arrow",
  "🔝": "顶部 / Top Arrow",
  "✝️": "十字架 / Latin Cross",
  "☦️": "东正教十字 / Orthodox Cross",
  "☪️": "星月 / Star and Crescent",
  "🕉️": "欧姆 / Om",
  "✡️": "大卫之星 / Star of David",
  "☸️": "法轮 / Wheel of Dharma",
  "♈": "白羊座 / Aries",
  "♉": "金牛座 / Taurus",
  "♊": "双子座 / Gemini",
  "♋": "巨蟹座 / Cancer",
  "♌": "狮子座 / Leo",
  "♍": "处女座 / Virgo",
  "♎": "天秤座 / Libra",
  "♏": "天蝎座 / Scorpio",
  "♐": "射手座 / Sagittarius",
  "♑": "摩羯座 / Capricorn",
  "♒": "水瓶座 / Aquarius",
  "♓": "双鱼座 / Pisces",
  "🔴": "红圆 / Red Circle",
  "🟠": "橙圆 / Orange Circle",
  "🟡": "黄圆 / Yellow Circle",
  "🟢": "绿圆 / Green Circle",
  "🔵": "蓝圆 / Blue Circle",
  "🟣": "紫圆 / Purple Circle",
  "⚫": "黑圆 / Black Circle",
  "⚪": "白圆 / White Circle",
  "🟤": "棕圆 / Brown Circle",
  "🔺": "红三角上 / Red Triangle Pointed Up",
  "🔻": "红三角下 / Red Triangle Pointed Down",
  "🔸": "橙菱形 / Small Orange Diamond",
  "🔹": "蓝菱形 / Small Blue Diamond",
  "🔶": "大橙菱形 / Large Orange Diamond",
  "🔷": "大蓝菱形 / Large Blue Diamond",
  "◾": "黑方块 / Black Medium-Small Square",
  "◽": "白方块 / White Medium-Small Square",
  "⬛": "大黑方块 / Black Large Square",
  "⬜": "大白方块 / White Large Square",
  "▪️": "黑小方块 / Black Small Square",
  "▫️": "白小方块 / White Small Square",
  "♾️": "无限 / Infinity",
  "✖️": "乘号 / Multiply",
  "➕": "加号 / Plus",
  "➖": "减号 / Minus",
  "➗": "除号 / Divide",
  "〰️": "波浪线 / Wavy Dash",
  "❗": "感叹号 / Exclamation Mark",
  "❓": "问号 / Question Mark",
  "❕": "白感叹号 / White Exclamation Mark",
  "❔": "白问号 / White Question Mark",
  "💯": "一百分 / Hundred Points",
  "✅": "勾选 / Check Mark Button",
  "❌": "叉号 / Cross Mark",
  "⭕": "空心圆 / Hollow Red Circle",
  "✳️": "星号 / Eight-Spoked Asterisk",
  "✴️": "八角星 / Eight-Pointed Star",
  "❇️": "闪烁 / Sparkle",
  "💢": "愤怒符号 / Anger Symbol",
  "💬": "对话气泡 / Speech Balloon",
  "💭": "思考气泡 / Thought Balloon",
  "🗨️": "左对话泡 / Left Speech Bubble",
  "🗯️": "愤怒对话泡 / Right Anger Bubble",
  "💤": "呼噜 / Zzz",
  "💈": "理发店转灯 / Barber Pole",
  "🎏": "鲤鱼旗 / Carp Streamer",
  "🎐": "风铃 / Wind Chime",
  "🧿": "邪眼 / Nazar Amulet",
  "♻️": "回收 / Recycling Symbol",
  "🔱": "三叉戟 / Trident Emblem",
  "⚜️": "鸢尾花 / Fleur-de-Lis",
  "📛": "名牌 / Name Badge",
  "🔞": "成人限制 / No One Under Eighteen",
  "0️⃣": "数字0 / Keycap Digit Zero",
  "1️⃣": "数字1 / Keycap Digit One",
  "2️⃣": "数字2 / Keycap Digit Two",
  "3️⃣": "数字3 / Keycap Digit Three",
  "4️⃣": "数字4 / Keycap Digit Four",
  "5️⃣": "数字5 / Keycap Digit Five",
  "6️⃣": "数字6 / Keycap Digit Six",
  "7️⃣": "数字7 / Keycap Digit Seven",
  "8️⃣": "数字8 / Keycap Digit Eight",
  "9️⃣": "数字9 / Keycap Digit Nine",
  "🔟": "数字10 / Keycap 10",
  "#️⃣": "井号键 / Keycap Number Sign",
  "*️⃣": "星号键 / Keycap Asterisk",
  "ℹ️": "信息 / Information",
  "🆗": "OK / OK Button",
  "🆕": "新 / NEW Button",
  "🆙": "升级 / UP! Button",
  "🆒": "酷 / COOL Button",
  "🆓": "免费 / FREE Button",
  "🆖": "无 / NG Button",
  "🎦": "影院 / Cinema",
  "📶": "信号 / Antenna Bars",
  "🇨🇳": "中国国旗 / Flag: China",
  "🇺🇸": "美国国旗 / Flag: United States",
  "🇯🇵": "日本国旗 / Flag: Japan",
  "🇰🇷": "韩国国旗 / Flag: South Korea",
  "🇬🇧": "英国国旗 / Flag: United Kingdom",
  "🇫🇷": "法国国旗 / Flag: France",
  "🇩🇪": "德国国旗 / Flag: Germany",
  "🇮🇹": "意大利国旗 / Flag: Italy",
  "🇪🇸": "西班牙国旗 / Flag: Spain",
  "🇷🇺": "俄罗斯国旗 / Flag: Russia",
  "🇧🇷": "巴西国旗 / Flag: Brazil",
  "🇮🇳": "印度国旗 / Flag: India",
  "🇨🇦": "加拿大国旗 / Flag: Canada",
  "🇦🇺": "澳大利亚国旗 / Flag: Australia",
  "🏳️": "白旗 / White Flag",
  "🏴": "黑旗 / Black Flag",
  "🏁": "方格旗 / Chequered Flag",
  "🚩": "三角旗 / Triangular Flag",
  "🏳️‍🌈": "彩虹旗 / Rainbow Flag",
  "🏴‍☠️": "海盗旗 / Pirate Flag",
  "🎌": "交叉旗 / Crossed Flags",
  "🏻": "浅肤色 / Light Skin Tone",
  "🏼": "中浅肤色 / Medium-Light Skin Tone",
  "🏽": "中等肤色 / Medium Skin Tone",
  "🏾": "中深肤色 / Medium-Dark Skin Tone",
  "🏿": "深肤色 / Dark Skin Tone",
  "🦰": "红发 / Red Hair",
  "🦱": "卷发 / Curly Hair",
  "🦲": "白发 / White Hair",
  "🦳": "秃顶 / Bald",
};

export const state = {
  version: 2,
  settings: { ...DEFAULT_SETTINGS },
  categories: [],
  items: [],
  favCategories: [],
  favItems: [],
  // 场景管理(独立分类树 + 场景条目,字段结构与资源目录对齐)
  sceneCategories: [],
  scenes: [],
  // 网址收藏夹(网络资源抓取:分类树可嵌套 + 网址条目)
  webBookmarkCategories: [],
  webBookmarks: [],
  // 开发工具箱:API 管理(分类树可嵌套 + 项目 + API 数据字典)
  apiCategories: [],
  apiProjects: [],
  apiEndpoints: [],
  // 资源工具箱:可嵌套目录树(用户目录 + 内置工具链接)
  toolboxFolders: [],
  // 侧栏菜单管理:整棵侧栏菜单树(目录 + 终端)
  menuNodes: [],
};

// ---------------- 资源类型分组 ----------------

/** 四类资源的类型分组 */
export const TYPE_GROUPS = {
  anim: ['spine', 'dragonbones'],
  image: ['image'],
  audio: ['audio'],
  '3d': ['model'],
  fgui: ['fgui'],
};

/** 类型显示名 */
export const TYPE_LABEL = {
  spine: 'Spine',
  dragonbones: 'DB',
  image: '图片',
  audio: '音频',
  model: '3D',
  fgui: 'FGUI',
};

/** 内置类型 → 识别扩展名(设置页展示用) */
export const TYPE_EXTENSIONS = {
  spine: ['.json', '.skel', '.sk', '.bin'],
  dragonbones: ['.json'],
  image: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tga', '.ico'],
  audio: ['.mp3', '.wav', '.ogg', '.flac', '.wma', '.m4a'],
  model: ['.glb', '.gltf', '.obj', '.fbx', '.dae', '.stl', '.blend', '.3ds', '.pmx', '.pmd', '.vrm'],
};

// ---------------- 自定义资源类型 ----------------

export function customTypes() {
  return Array.isArray(state.settings.customTypes) ? state.settings.customTypes : [];
}
export function customTypeById(id) {
  return customTypes().find((t) => t.id === id) || null;
}
/** 新增自定义资源类型;exts 形如 ['.png','.ico'] */
export function addCustomType({ name = '', group = 'image', exts = [], icon = '' }) {
  const cleanExts = [...new Set((Array.isArray(exts) ? exts : [])
    .map((e) => String(e).trim().toLowerCase())
    .filter((e) => e.startsWith('.') && e.length > 1))];
  if (!cleanExts.length) return null;
  const t = {
    id: uid('ct'),
    name: String(name || '').trim() || '未命名类型',
    group: ['anim', 'image', 'audio', '3d'].includes(group) ? group : 'image',
    exts: cleanExts,
    icon: icon || '',
  };
  customTypes().push(t);
  setSetting('customTypes', customTypes());
  return t;
}
export function updateCustomType(id, patch) {
  const t = customTypeById(id);
  if (!t) return null;
  if (Array.isArray(patch.exts)) {
    patch.exts = [...new Set(patch.exts.map((e) => String(e).trim().toLowerCase()).filter((e) => e.startsWith('.') && e.length > 1))];
    if (!patch.exts.length) return null;
  }
  if (patch.group && !['anim', 'image', 'audio', '3d'].includes(patch.group)) patch.group = 'image';
  Object.assign(t, patch);
  setSetting('customTypes', customTypes());
  return t;
}
export function removeCustomType(id) {
  const arr = customTypes();
  const i = arr.findIndex((x) => x.id === id);
  if (i < 0) return;
  arr.splice(i, 1);
  setSetting('customTypes', arr);
}

// ---------------- 自定义资源分组 ----------------

export function customTypeGroups() {
  return Array.isArray(state.settings.customTypeGroups) ? state.settings.customTypeGroups : [];
}
export function customTypeGroupById(id) {
  return customTypeGroups().find((g) => g.id === id) || null;
}
/** 新增自定义资源分组;exts 形如 ['.db','.txt'](扫描时按扩展名归 type=<分组id>) */
export function addCustomTypeGroup({ name = '', icon = '', exts = [] }) {
  const cleanExts = [...new Set((Array.isArray(exts) ? exts : [])
    .map((e) => String(e).trim().toLowerCase())
    .filter((e) => e.startsWith('.') && e.length > 1))];
  if (!cleanExts.length) return null;
  const g = {
    id: uid('cg'),
    name: String(name || '').trim() || '未命名分组',
    icon: icon || '',
    exts: cleanExts,
  };
  customTypeGroups().push(g);
  setSetting('customTypeGroups', customTypeGroups());
  return g;
}
export function updateCustomTypeGroup(id, patch) {
  const g = customTypeGroupById(id);
  if (!g) return null;
  if (Array.isArray(patch.exts)) {
    patch.exts = [...new Set(patch.exts.map((e) => String(e).trim().toLowerCase()).filter((e) => e.startsWith('.') && e.length > 1))];
    if (!patch.exts.length) return null;
  }
  Object.assign(g, patch);
  setSetting('customTypeGroups', customTypeGroups());
  return g;
}
export function removeCustomTypeGroup(id) {
  const arr = customTypeGroups();
  const i = arr.findIndex((x) => x.id === id);
  if (i < 0) return;
  arr.splice(i, 1);
  setSetting('customTypeGroups', arr);
}
/**
 * 自修复:凡是被「分类目录」引用到的自定义资源分组,都确保左侧栏存在对应的资源根菜单节点
 * (action = 'res:group:<分组id>')。否则该分类在左侧菜单栏无挂载点 → 看不见,
 * 但系统设置「分类目录」里能看到。转换菜单目录为分类、或分类引用了某自定义分组时都可能触发。
 */
export function ensureResourceRootsForCategories() {
  const groups = customTypeGroups();
  if (!groups.length) return;
  const used = new Set();
  for (const c of state.categories || []) {
    for (const t of (Array.isArray(c.typeTags) ? c.typeTags : [])) used.add(t);
  }
  const idx3d = state.menuNodes.findIndex((m) => m.id === '__m_res_3d__');
  const baseSort = (idx3d >= 0 && typeof state.menuNodes[idx3d].sort === 'number')
    ? state.menuNodes[idx3d].sort : state.menuNodes.length - 1;
  let gi = 0;
  let changed = false;
  for (const g of groups) {
    if (!used.has(g.id)) continue;
    const action = 'res:group:' + g.id;
    if (state.menuNodes.some((m) => (m.action || '') === action)) continue;
    state.menuNodes.push({
      id: uid('mn'),
      name: g.name || '未命名分组',
      icon: (g.icon && String(g.icon).trim()) ? g.icon : '🗂',
      parentId: '',
      nodeType: 'dir',
      actionType: 'builtin',
      action,
      tooltip: g.name || '',
      note: '',
      typeTags: [],
      isResource: true,
      sort: baseSort + 0.5 + gi * 0.01,
      createdAt: now(),
      updatedAt: now(),
    });
    gi++;
    changed = true;
  }
  if (changed) {
    // 把新建的资源根(及既有 res:group 根)统一挪到「3D资源」之后,使资源根成组
    if (idx3d >= 0) {
      const gNodes = state.menuNodes.filter((m) => (m.action || '').startsWith('res:group:'));
      for (const n of gNodes) state.menuNodes.splice(state.menuNodes.indexOf(n), 1);
      const at = state.menuNodes.findIndex((m) => m.id === '__m_res_3d__') + 1;
      state.menuNodes.splice(at, 0, ...gNodes);
    }
    saveState();
  }
}

/**
 * 自修复:在「图标资源」分组根下确保存在「emoji 图标」管理入口菜单节点(action = 'page:emoji')。
 * 这样用户可在左侧栏「图标资源」分类内直接打开 emoji 图标库浏览与管理页。幂等(已存在则跳过)。
 */
export function ensureEmojiMenuNode() {
  // 找到「图标」自定义资源分组对应的资源根菜单节点(名称含「图标」即视为图标资源根)
  const grp = customTypeGroups().find((g) => (g.name || '').includes('图标'));
  if (!grp) return;
  const rootAction = 'res:group:' + grp.id;
  const root = state.menuNodes.find((m) => (m.action || '') === rootAction);
  if (!root) return;
  // 按名称(忽略空格差异)匹配「图标」根下的 emoji 图标节点,兼容其 action 曾被误改为其它页面的情况
  const norm = (s) => (s || '').replace(/\s+/g, '');
  const kids = state.menuNodes.filter(
    (m) => (m.parentId || '') === root.id && norm(m.name) === 'emoji图标'
  );
  if (kids.length) {
    // 取第一个为主节点,修正其 action/actionType;其余同名(重复)节点删除,避免重复入口
    const main = kids[0];
    main.action = 'page:emoji';
    main.actionType = 'builtin';
    if (kids.length > 1) {
      const dupIds = new Set(kids.slice(1).map((k) => k.id));
      state.menuNodes = state.menuNodes.filter((m) => !dupIds.has(m.id));
    }
    saveState();
    return;
  }
  state.menuNodes.push({
    id: uid('mn'),
    name: 'emoji 图标',
    icon: '😀',
    parentId: root.id,
    nodeType: 'term',
    actionType: 'builtin',
    action: 'page:emoji',
    tooltip: 'emoji 图标库浏览与管理',
    note: '',
    typeTags: [],
    isResource: false,
    sort: 0,
    createdAt: now(),
    updatedAt: now(),
  });
  saveState();
}

/** 资源类型 → 分组('anim' | 'image' | 'audio' | '3d' | 自定义分组 id | 'fgui');自定义类型按配置归属,自定义分组 id → 自身 */
export function typeGroup(type) {
  const ct = customTypeById(type);
  if (ct) return ct.group || 'image';
  if (customTypeGroupById(type)) return type; // 自定义分组 id 本身作为 type(分组默认条目)
  if (type === 'image') return 'image';
  if (type === 'audio') return 'audio';
  if (type === 'model') return '3d';
  if (type === 'fgui') return 'fgui';
  return 'anim';
}

/** 是否图片类资源(含自定义 image 分组类型;用于缩略图/预览) */
export function isImageType(type) {
  return typeGroup(type) === 'image';
}

/** 类型显示名(自定义类型/自定义分组优先) */
export function typeLabel(type) {
  const ct = customTypeById(type);
  if (ct) return ct.name;
  const g = customTypeGroupById(type);
  if (g) return g.name;
  return TYPE_LABEL[type] || type;
}

/** 扩展名 → 类型:自定义类型 > 自定义分组 > 内置 */
export function extToType(ext) {
  const e = String(ext || '').toLowerCase();
  for (const ct of customTypes()) {
    if (ct.exts && ct.exts.includes(e)) return ct.id;
  }
  for (const g of customTypeGroups()) {
    if (g.exts && g.exts.includes(e)) return g.id;
  }
  if (TYPE_EXTENSIONS.image.includes(e)) return 'image';
  if (TYPE_EXTENSIONS.audio.includes(e)) return 'audio';
  if (TYPE_EXTENSIONS.model.includes(e)) return 'model';
  return null;
}

/** 目录/分类可标记的分组标签选项(内置 + 自定义分组);数据与设置页资源类型管理一致 */
export function groupTagOptions() {
  const out = [];
  for (const [v, l] of Object.entries(CAT_TYPE_TAG_LABELS)) out.push({ value: v, label: l });
  for (const g of customTypeGroups()) out.push({ value: g.id, label: g.name });
  return out;
}
/** 是否为有效分组标签(内置或自定义分组) */
export function isValidTypeTag(t) {
  return !!(CAT_TYPE_TAG_LABELS[t] || customTypeGroupById(t));
}

// ---------------- 分类的资源类型标签 ----------------

/** 目录可标记的资源类型标签(勾选后目录只在对应类型的资源树中显示;不勾选 = 所有类型显示) */
export const CAT_TYPE_TAG_LABELS = {
  anim: '动画',
  image: '图片',
  audio: '音频',
  '3d': '3D',
  video: '视频',
  article: '文章',
  fgui: 'UI',
};

/** 全部标签 key(供勾选组按固定顺序渲染) */
export const CAT_TYPE_TAGS = Object.keys(CAT_TYPE_TAG_LABELS);

/** 分类的资源类型标签数组(过滤非法值,兼容旧数据 undefined/字符串;内置 + 自定义分组) */
export function categoryTypeTags(cat) {
  if (!cat) return [];
  const raw = Array.isArray(cat.typeTags) ? cat.typeTags : [];
  return raw.filter((t) => isValidTypeTag(t));
}

/** 分类资源类型标签的中文名数组(如 ['音频']) */
export function categoryTypeTagNames(cat) {
  return categoryTypeTags(cat).map((t) => CAT_TYPE_TAG_LABELS[t] || ((customTypeGroupById(t) || {}).name) || t);
}

/**
 * 分类是否在指定资源分组下可见:
 * - 无标签 → 所有类型都显示
 * - 有标签 → 仅标签命中该分组的目录显示(可同时勾选多个标签)
 * - group 为空('home'/'all'/null 全部视图) → 始终显示
 * @param {object} cat 分类对象
 * @param {string|null} group 'anim'|'image'|'audio'|'3d'|'all'|null
 */
export function catVisibleInGroup(cat, group) {
  const tags = categoryTypeTags(cat);
  if (!tags.length) return true;
  if (!group || group === 'all') return true;
  return tags.includes(group);
}

/** 分类是否在"允许显示的类型组"集合中的任一类型组下可见:分类未勾选标签(全部)或标签命中任一类型组 */
export function catVisibleInAnyGroup(cat, tagSet) {
  const tags = categoryTypeTags(cat);
  if (!tags.length) return true; // 未勾选任何标签 = 所有类型组显示
  if (!tagSet || tagSet.size === 0) return true;
  return tags.some((t) => tagSet.has(t));
}

let saveTimer = null;

export async function loadState() {
  const data = await window.api.dbRead();
  if (!data) return;
  Object.assign(state, data);
  // 合并默认设置,保证旧库缺失的新字段被补齐(已有字段以库为准)
  state.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  // 兼容旧版:把旧全局 app* 外观字段并入 dark 主题(旧字段已废弃)
  if (!state.settings.themes || typeof state.settings.themes !== 'object') {
    state.settings.themes = { dark: {}, light: {}, custom: {} };
  }
  const legacy = data.settings || {};
  if (legacy.appAccent != null) state.settings.themes.dark.accent = legacy.appAccent;
  if (legacy.appBgColor != null) state.settings.themes.dark.bgColor = legacy.appBgColor;
  if (legacy.appBgImage != null) {
    state.settings.themes.dark.bgImage = legacy.appBgImage;
    state.settings.themes.dark.bgImageOn = !!legacy.appBgImageOn;
  }
  state.categories = Array.isArray(data.categories) ? data.categories : [];
  state.items = Array.isArray(data.items) ? data.items : [];
  state.favCategories = Array.isArray(data.favCategories) ? data.favCategories : [];
  state.favItems = Array.isArray(data.favItems) ? data.favItems : [];
  state.sceneCategories = Array.isArray(data.sceneCategories) ? data.sceneCategories : [];
  state.scenes = Array.isArray(data.scenes) ? data.scenes : [];
  state.apiCategories = Array.isArray(data.apiCategories) ? data.apiCategories : [];
  state.apiProjects = Array.isArray(data.apiProjects) ? data.apiProjects : [];
  state.apiEndpoints = Array.isArray(data.apiEndpoints) ? data.apiEndpoints : [];
  // 资源工具箱目录树(兼容旧库缺字段)
  state.toolboxFolders = Array.isArray(data.toolboxFolders) ? data.toolboxFolders : [];
  for (const tf of state.toolboxFolders) {
    if (tf.parentId == null) tf.parentId = '';
    if (tf.toolId == null) tf.toolId = '';
    if (tf.icon == null) tf.icon = '';
  }
  seedToolboxFolders();
  // 侧栏菜单树(兼容旧库缺字段)
  state.menuNodes = Array.isArray(data.menuNodes) ? data.menuNodes : [];
  let resMigrated = false;
  for (const mn of state.menuNodes) {
    if (mn.parentId == null) mn.parentId = '';
    if (mn.icon == null) mn.icon = '';
    if (mn.tooltip == null) mn.tooltip = '';
    if (mn.note == null) mn.note = '';
    if (mn.nodeType == null) mn.nodeType = 'dir';
    if (mn.actionType == null) mn.actionType = '';
    if (mn.action == null) mn.action = '';
    if (!Array.isArray(mn.typeTags)) mn.typeTags = [];
    // 资源属性:命名资源目录(动画资源/图片资源/图标库资源/音频资源/3D资源/项目管理)及其子孙恒为「是」;
    // 其余目录沿用已存储值(旧库缺字段时按祖先链推导并默认否)。命名目录子孙即使库中存 0 也强制 true。
    const derivedRes = computeIsResource(mn, state.menuNodes);
    const storedRes = (typeof mn.isResource === 'boolean') ? mn.isResource : derivedRes;
    const nextRes = derivedRes ? true : storedRes;
    if (mn.isResource !== nextRes) { mn.isResource = nextRes; resMigrated = true; }
  }
  if (resMigrated) saveState();
  seedMenuNodes();
  // 自修复:被分类目录引用的自定义资源分组,确保左侧栏有对应资源根(否则分类在侧栏不可见)
  ensureResourceRootsForCategories();
  // 自修复:在「图标资源」分组根下挂载「emoji 图标」管理入口
  ensureEmojiMenuNode();
  // 合并默认 emoji 图标库(补齐新增 emoji / 分类,去重不重复)
  mergeDefaultIconLibrary();
  // 兼容字段:旧库无 tags 时补 []
  for (const it of state.items) {
    if (!Array.isArray(it.tags)) it.tags = [];
  }
  // 兼容字段:旧库分类无 typeTags 时补 [](无标签 = 所有资源类型显示)
  for (const c of state.categories) {
    if (!Array.isArray(c.typeTags)) c.typeTags = [];
  }
  // 图标库:无自定义数据时 seed 默认 5 组(emoji)
  if (!Array.isArray(state.settings.iconGroups) || !state.settings.iconGroups.length) {
    state.settings.iconGroups = DEFAULT_ICON_LIBRARY.map((g, i) => ({ id: uid('ig'), name: g.group, sort: i }));
    state.settings.iconItems = [];
    let sort = 0;
    for (const g of state.settings.iconGroups) {
      const src = DEFAULT_ICON_LIBRARY.find((d) => d.group === g.name);
      for (const e of (src ? src.items : [])) {
        state.settings.iconItems.push({ id: uid('ii'), groupId: g.id, name: EMOJI_NAMES[e.replace(/\uFE0F/g, '')] || '', icon: e, sort: sort++ });
      }
    }
  } else {
    // 旧图标库迁移:为缺名称的 emoji 图标补中英文名(此前 name 为空)
    let nameFixed = false;
    for (const it of (Array.isArray(state.settings.iconItems) ? state.settings.iconItems : [])) {
      if (!it.name && it.icon && !isImageIcon(it.icon)) {
        const nm = EMOJI_NAMES[String(it.icon).replace(/\uFE0F/g, '')];
        if (nm) { it.name = nm; nameFixed = true; }
      }
    }
    if (nameFixed) saveState();
  }
}

/** 防抖保存到磁盘 */
export function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await window.api.dbWrite(state);
    } catch (err) {
      console.error('保存失败', err);
    }
  }, 150);
}

export function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function now() {
  return Date.now();
}

// ---------------- 分类 ----------------

/** 新增分类;parentId 为 '' 表示顶级分类,否则为父分类 id(子分类);typeTags 为资源类型标签数组(如 ['audio'],空 = 所有类型显示) */
export function addCategory({ name, remark = '', parentId = '', typeTags = [] }) {
  const cat = {
    id: uid('c'),
    name,
    remark,
    parentId: parentId || '',
    typeTags: Array.isArray(typeTags) ? typeTags.filter((t) => isValidTypeTag(t)) : [],
    sort: state.categories.length,
    createdAt: now(),
  };
  state.categories.push(cat);
  saveState();
  return cat;
}

export function updateCategory(id, patch) {
  const cat = state.categories.find((c) => c.id === id);
  if (!cat) return null;
  Object.assign(cat, patch, { updatedAt: now() });
  saveState();
  return cat;
}

/** 删除分类:其子分类提升为顶级,其下动画移到「未分类」(categoryId = '') */
export function removeCategory(id) {
  state.categories = state.categories.filter((c) => c.id !== id);
  for (const c of state.categories) {
    if (c.parentId === id) c.parentId = '';
  }
  for (const it of state.items) {
    if (it.categoryId === id) it.categoryId = '';
  }
  saveState();
}

/**
 * 删除分类(增强版,由删除确认对话框调用)
 * @param {string} id 分类 id
 * @param {object} opts
 *   - deleteItems {boolean} true → 删除该分类(含全部子孙分类)下所有动画条目(非物理文件);
 *                             false → 动画移到「未分类」(categoryId='')
 *   - subAction {'parent'|'top'|'category'} 子分类去向:
 *       'parent'   → 提升为被删分类的父分类的子类别(顶级分类则为顶级)
 *       'top'      → 提升为顶级分类
 *       'category' → 移动到 subTargetId 分类下
 *   - subTargetId {string} subAction==='category' 时的目标分类 id
 *   deleteItems=true 时子分类一并删除(其下动画也删除)。
 */
export function removeCategoryAdvanced(id, opts = {}) {
  const cat = categoryById(id);
  if (!cat) return;
  const { deleteItems = false, subAction = 'parent', subTargetId = '' } = opts;
  const subs = getCategoryChildren(id);
  const catIds = new Set([id, ...getCategoryDescendants(id)]);
  const parentPid = cat.parentId || '';

  // 1) 动画:删除或移到未分类
  if (deleteItems) {
    const delIds = state.items.filter((i) => catIds.has(i.categoryId)).map((i) => i.id);
    state.items = state.items.filter((i) => !catIds.has(i.categoryId));
    for (const did of delIds) cleanupFavItems(did);
  } else {
    for (const it of state.items) {
      if (catIds.has(it.categoryId)) it.categoryId = '';
    }
  }

  // 2) 子分类:删除或调整父级
  for (const sub of subs) {
    if (deleteItems) {
      removeCategoryAdvanced(sub.id, { deleteItems: true });
    } else if (subAction === 'parent') {
      sub.parentId = parentPid;
    } else if (subAction === 'top') {
      sub.parentId = '';
    } else if (subAction === 'category') {
      sub.parentId = subTargetId || '';
    }
  }

  // 3) 移除自身
  state.categories = state.categories.filter((c) => c.id !== id);
  saveState();
}

export function categoryById(id) {
  return state.categories.find((c) => c.id === id) || null;
}

/** 按名称查找分类(同父级下不区分大小写),不存在则用该名称自动创建并返回 */
export function findOrCreateCategoryByName(name, parentId = '') {
  const key = String(name || '').trim();
  if (!key) return null;
  let cat = state.categories.find(
    (c) => (c.parentId || '') === parentId && c.name.toLowerCase() === key.toLowerCase()
  );
  if (!cat) cat = addCategory({ name: key, parentId });
  return cat;
}

// ---------------- 分类树辅助 ----------------

/** 某分类的直接子分类(按数组顺序,即渲染顺序) */
export function getCategoryChildren(parentId) {
  const pid = parentId || '';
  return state.categories.filter((c) => (c.parentId || '') === pid);
}

/** catId 是否为 ancestorId 的后代 */
export function isCategoryDescendant(catId, ancestorId) {
  let cur = categoryById(catId);
  while (cur && cur.parentId) {
    if (cur.parentId === ancestorId) return true;
    cur = categoryById(cur.parentId);
  }
  return false;
}

/** 某分类的所有后代 id(不含自身) */
export function getCategoryDescendants(catId) {
  const out = [];
  const collect = (pid) => {
    for (const c of state.categories) {
      if ((c.parentId || '') === pid) {
        out.push(c.id);
        collect(c.id);
      }
    }
  };
  collect(catId);
  return out;
}

/** 分类路径名,如「场景 / 主城 / 特效」(用于移动对话框候选显示) */
export function categoryPath(catId) {
  const parts = [];
  let cur = categoryById(catId);
  while (cur) {
    parts.unshift(cur.name);
    cur = cur.parentId ? categoryById(cur.parentId) : null;
  }
  return parts.join(' / ');
}

/**
 * 拖动排序分类:把 fromId 的分类移到 toId 分类的上方(before)或下方(after)。
 * 数组顺序即渲染顺序,同时同步每个分类的 sort 字段保持一致。
 */
export function reorderCategory(fromId, toId, place = 'before') {
  const fromIdx = state.categories.findIndex((c) => c.id === fromId);
  if (fromIdx < 0) return null;
  const [moved] = state.categories.splice(fromIdx, 1);
  let toIdx = state.categories.findIndex((c) => c.id === toId);
  if (toIdx < 0) toIdx = state.categories.length;
  if (place === 'after') toIdx += 1;
  state.categories.splice(toIdx, 0, moved);
  state.categories.forEach((c, i) => { c.sort = i; });
  saveState();
  return moved;
}

/** 批量删除「未分类」下的全部动画条目(仅移出列表,不删磁盘文件),同步清理收藏引用。返回删除数量 */
export function removeUncategorizedItems() {
  const ids = state.items.filter((i) => !i.categoryId).map((i) => i.id);
  state.items = state.items.filter((i) => i.categoryId);
  for (const id of ids) cleanupFavItems(id);
  saveState();
  return ids.length;
}

// ---------------- 动画条目 ----------------

/**
 * 确保分类的 typeTags 包含指定资源类型所属的分组。
 * 仅当分类已勾选过标签(非「全部类型」)时才扩展;未勾选标签的分类保持「全部类型」不变。
 */
export function ensureCategoryTypeTag(catId, type) {
  const cat = catId ? categoryById(catId) : null;
  if (!cat) return;
  const tags = categoryTypeTags(cat);
  if (!tags.length) return; // 未勾选任何标签 = 全类型,无需扩展
  const g = typeGroup(type);
  if (!g || tags.includes(g)) return;
  cat.typeTags = [...tags, g];
  saveState();
}

export function addItem({ categoryId, type, filePath, atlasPath = null, displayName, remark = '', size = null, mtime = null, tags = [] }) {
  ensureCategoryTypeTag(categoryId, type);
  const item = {
    id: uid('i'),
    categoryId: categoryId || '',
    type, // 'spine' | 'dragonbones' | 'image' | 'audio'
    filePath,
    atlasPath,
    displayName: displayName || filePath.split(/[\\/]/).pop().replace(/\.[^.]+$/, ''),
    remark,
    tags: cleanTags(tags),
    size,
    mtime,
    createdAt: now(),
    updatedAt: now(),
  };
  state.items.push(item);
  saveState();
  return item;
}

export function updateItem(id, patch) {
  const item = state.items.find((i) => i.id === id);
  if (!item) return null;
  Object.assign(item, patch, { updatedAt: now() });
  saveState();
  return item;
}

export function removeItem(id) {
  state.items = state.items.filter((i) => i.id !== id);
  cleanupFavItems(id);
  saveState();
}

export function itemById(id) {
  return state.items.find((i) => i.id === id) || null;
}

// ---------------- 标签 ----------------

/**
 * 规范化标签:输入可以是数组或字符串(按空格/逗号分隔)。
 * 去空白、去重、忽略空项,保持原顺序。单个标签内不允许空格。
 * @param {string|string[]} input
 * @returns {string[]}
 */
export function cleanTags(input) {
  if (input == null) return [];
  const raw = Array.isArray(input) ? input : String(input);
  const out = [];
  const seen = new Set();
  for (const part of raw) {
    for (const t of String(part).split(/[\s,，、]+/)) {
      const tag = t.trim();
      if (tag && !seen.has(tag)) {
        seen.add(tag);
        out.push(tag);
      }
    }
  }
  return out;
}

/** 条目的标签数组(兼容旧数据:undefined / 字符串) */
export function itemTags(item) {
  if (!item) return [];
  return cleanTags(item.tags);
}

/** 全库标签库(去重排序),供标签建议下拉 / 标签过滤使用 */
export function allTags() {
  const set = new Set();
  for (const it of state.items) {
    for (const t of itemTags(it)) set.add(t);
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

/** 设置条目标签(去重后保存) */
export function setItemTags(id, tags) {
  const item = itemById(id);
  if (!item) return null;
  item.tags = cleanTags(tags);
  item.updatedAt = now();
  saveState();
  return item;
}

// ---------------- 设置 ----------------

export function setSetting(key, value) {
  state.settings[key] = value;
  saveState();
}

/** 最近打开(首页展示与再次打开): 去重按 path, 最新在前, 上限 20, 持久化 */
export function recordRecentOpen({ name = '', path = '', type = '', tab = '', itemId = null }) {
  if (!path) return;
  const norm = String(path).replace(/\\/g, '/');
  const list = Array.isArray(state.settings.recentOpens) ? [...state.settings.recentOpens] : [];
  const idx = list.findIndex((r) => r.path && String(r.path).replace(/\\/g, '/') === norm);
  if (idx >= 0) list.splice(idx, 1);
  list.unshift({ name, path, type, tab, itemId, openedAt: now() });
  state.settings.recentOpens = list.slice(0, 20);
  saveState();
}

// ---------------- 收藏夹 ----------------

/** 新建收藏夹分类目录 */
export function addFavCategory({ name }) {
  const fc = { id: uid('f'), name, sort: state.favCategories.length, createdAt: now(), updatedAt: now() };
  state.favCategories.push(fc);
  saveState();
  return fc;
}

export function updateFavCategory(id, patch) {
  const fc = state.favCategories.find((c) => c.id === id);
  if (!fc) return null;
  Object.assign(fc, patch, { updatedAt: now() });
  saveState();
  return fc;
}

/** 删除收藏夹分类,其下收藏项移到「未分类收藏」(favCategoryId='') */
export function removeFavCategory(id) {
  state.favCategories = state.favCategories.filter((c) => c.id !== id);
  for (const f of state.favItems) {
    if (f.favCategoryId === id) f.favCategoryId = '';
  }
  saveState();
}

export function favCategoryById(id) {
  return state.favCategories.find((c) => c.id === id) || null;
}

/**
 * 拖动排序收藏分类:把 fromId 移到 toId 的上方(before)或下方(after)。
 * 数组顺序即渲染顺序,同时同步每个收藏分类的 sort 字段保持一致。
 */
export function reorderFavCategory(fromId, toId, place = 'before') {
  const fromIdx = state.favCategories.findIndex((c) => c.id === fromId);
  if (fromIdx < 0) return null;
  const [moved] = state.favCategories.splice(fromIdx, 1);
  let toIdx = state.favCategories.findIndex((c) => c.id === toId);
  if (toIdx < 0) toIdx = state.favCategories.length;
  if (place === 'after') toIdx += 1;
  state.favCategories.splice(toIdx, 0, moved);
  state.favCategories.forEach((c, i) => { c.sort = i; });
  saveState();
  return moved;
}

/** 收藏一个动画到指定收藏分类(可重复收藏到多个位置;favCategoryId='' 表示未分类收藏) */
export function addFavItem(itemId, favCategoryId = '') {
  const item = itemById(itemId);
  if (!item) return null;
  // 同一动画同一收藏分类不重复
  if (state.favItems.some((f) => f.itemId === itemId && f.favCategoryId === favCategoryId)) return null;
  const f = { id: uid('f'), itemId, favCategoryId: favCategoryId || '', createdAt: now() };
  state.favItems.push(f);
  saveState();
  return f;
}

/** 取消收藏(按 itemId + favCategoryId) */
export function removeFavItem(itemId, favCategoryId) {
  state.favItems = state.favItems.filter((f) => !(f.itemId === itemId && (favCategoryId === undefined || f.favCategoryId === favCategoryId)));
  saveState();
}

/** 移动收藏项到另一个收藏分类 */
export function moveFavItem(favId, newFavCategoryId) {
  const f = state.favItems.find((x) => x.id === favId);
  if (!f) return null;
  // 目标已存在同动画同分类 → 删除当前(避免重复)
  if (state.favItems.some((x) => x.id !== favId && x.itemId === f.itemId && x.favCategoryId === newFavCategoryId)) {
    state.favItems = state.favItems.filter((x) => x.id !== favId);
  } else {
    f.favCategoryId = newFavCategoryId || '';
  }
  saveState();
  return f;
}

/** 删除动画时同步移除相关收藏 */
export function cleanupFavItems(itemId) {
  const n = state.favItems.length;
  state.favItems = state.favItems.filter((f) => f.itemId !== itemId);
  if (n !== state.favItems.length) saveState();
}

/** 某动画被收藏的位置列表(收藏分类名) */
export function favLocations(itemId) {
  return state.favItems
    .filter((f) => f.itemId === itemId)
    .map((f) => (f.favCategoryId ? favCategoryById(f.favCategoryId)?.name : '') || '未分类收藏');
}

/** 是否已收藏(任一位置) */
export function isFavored(itemId) {
  return state.favItems.some((f) => f.itemId === itemId);
}

/**
 * 收藏夹主页数据:收藏总数(含重复收藏位置) / 涉及资源数 / 类型分布 / 收藏分类列表 / 最近收藏。
 * @returns {{ total, itemCount, byType, favCategories: [{fc,count}], recent: [{fav,item}] }}
 */
export function getFavHomeData() {
  const byType = { anim: 0, image: 0, audio: 0, '3d': 0 };
  const seenItems = new Set();
  let itemCount = 0;
  for (const f of state.favItems) {
    const it = itemById(f.itemId);
    if (!it) continue;
    byType[typeGroup(it.type)]++;
    if (!seenItems.has(it.id)) {
      seenItems.add(it.id);
      itemCount++;
    }
  }
  const favCategories = state.favCategories.map((fc) => ({
    fc,
    count: state.favItems.filter((f) => f.favCategoryId === fc.id).length,
  }));
  const recent = [...state.favItems]
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 10)
    .map((f) => ({ fav: f, item: itemById(f.itemId) }))
    .filter((x) => x.item);
  return {
    total: state.favItems.length,
    itemCount,
    byType,
    favCategories,
    recent,
  };
}

// ---------------- 辅助查询 ----------------

/** 当前分类视图下的条目(含全部/未分类) */
export function itemsInCategory(catId) {
  if (catId === 'all') return [...state.items];
  if (catId === '') return state.items.filter((i) => !i.categoryId);
  return state.items.filter((i) => i.categoryId === catId);
}

export function categoryLabel(item) {
  if (!item.categoryId) return '未分类';
  const c = categoryById(item.categoryId);
  return c ? c.name : '未分类';
}

// ---------------- 游戏资源管理器:派生查询 ----------------

/** 按分组过滤条目('anim' 含 spine+dragonbones) */
export function itemsByGroup(group) {
  const types = TYPE_GROUPS[group] || [];
  return state.items.filter((i) => types.includes(i.type));
}

/** 某分类视图下指定分组的条目('all' 或 null = 全类型;含 '' 未分类 语义) */
export function itemsInCategoryAndGroup(catId, group) {
  const inCat = itemsInCategory(catId);
  if (!group || group === 'all') return inCat;
  // 按分组匹配(内置组 + 自定义分组/自定义类型):typeGroup 归一到分组 id
  return inCat.filter((i) => typeGroup(i.type) === group);
}

/** 格式化文件大小 */
export function formatSize(bytes) {
  if (bytes == null || bytes < 0) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

/** 格式化修改日期 */
export function formatDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 目录列表页数据:某分类下直接资源 + 直接子分类 + 统计
 * @returns {{ direct: items[], subcats: categories[], stats: { total, byType, totalSize } }}
 */
export function getFolderData(catId, group) {
  const direct = itemsInCategoryAndGroup(catId, group);
  const subcats = catId === 'all' ? [] : getCategoryChildren(catId);
  const byType = { anim: 0, image: 0, audio: 0, '3d': 0 };
  let totalSize = 0;
  for (const it of direct) {
    byType[typeGroup(it.type)]++;
    if (it.size != null) totalSize += it.size;
  }
  return {
    direct,
    subcats,
    stats: { total: direct.length, byType, totalSize },
  };
}

/**
 * 主页数据:全类型统计 + 目录统计 + 最近添加
 * @returns {{ total, byType, categories: [{cat,count,totalSize}], recent: items[] }}
 */
export function getHomeData() {
  const byType = { anim: 0, image: 0, audio: 0, '3d': 0, totalSize: 0 };
  for (const it of state.items) {
    byType[typeGroup(it.type)]++;
    if (it.size != null) byType.totalSize += it.size;
  }
  const categories = state.categories.map((cat) => {
    let count = 0;
    let totalSize = 0;
    for (const it of state.items) {
      if (it.categoryId === cat.id) {
        count++;
        if (it.size != null) totalSize += it.size;
      }
    }
    return { cat, count, totalSize };
  });
  const recent = [...state.items]
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, 10);
  return {
    total: state.items.length,
    byType,
    categories,
    recent,
  };
}

/**
 * 类型主页数据:某类型(anim/image/audio/3d)的资源统计 + 分类层级树(含各分类该类型资源数)。
 * @param {string} group 'anim' | 'image' | 'audio' | '3d'
 * @returns {{ total, totalSize, byType, categories: [{cat,count,totalSize,subs}], recent }}
 */
export function getTypeHomeData(group) {
  const items = state.items.filter((i) => typeGroup(i.type) === group);
  const byType = { anim: 0, image: 0, audio: 0, '3d': 0, totalSize: 0 };
  let totalSize = 0;
  for (const it of items) {
    byType[typeGroup(it.type)]++;
    if (it.size != null) totalSize += it.size;
  }
  // 分类层级树:每个分类节点含「该分类(含子孙)该类型资源数」
  // 按资源类型标签过滤:目录无标签或标签命中当前分组才显示
  const buildCatNode = (cat) => {
    const subs = getCategoryChildren(cat.id)
      .filter((c) => catVisibleInGroup(c, group))
      .map(buildCatNode);
    let count = 0;
    let sz = 0;
    const catIds = new Set([cat.id, ...getCategoryDescendants(cat.id)]);
    for (const it of items) {
      if (catIds.has(it.categoryId)) {
        count++;
        if (it.size != null) sz += it.size;
      }
    }
    return { cat, count, totalSize: sz, subs };
  };
  const categories = getCategoryChildren('')
    .filter((c) => catVisibleInGroup(c, group))
    .map(buildCatNode);
  const recent = [...items]
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, 10);
  return { total: items.length, totalSize, byType, categories, recent, items };
}

/** 排序条目:name→localeCompare;type→分组顺序+名称;size→大小;date→mtime||updatedAt */
export function sortItems(items, by = 'name', dir = 'asc') {
  const mult = dir === 'desc' ? -1 : 1;
  const arr = [...items];
  arr.sort((a, b) => {
    let r = 0;
    if (by === 'name') {
      r = (a.displayName || '').localeCompare(b.displayName || '', 'zh-Hans-CN', { numeric: true });
    } else if (by === 'type') {
      r = typeGroup(a.type).localeCompare(typeGroup(b.type)) || (a.displayName || '').localeCompare(b.displayName || '', 'zh-Hans-CN', { numeric: true });
    } else if (by === 'size') {
      const sa = a.size == null ? -1 : a.size;
      const sb = b.size == null ? -1 : b.size;
      r = sa - sb;
    } else if (by === 'date') {
      const da = a.mtime || a.updatedAt || 0;
      const db = b.mtime || b.updatedAt || 0;
      r = da - db;
    }
    return r * mult;
  });
  return arr;
}

/** 分类路径列表(含自身),供面包屑:如 [{id,name}...] */
export function getCategoryPathList(catId) {
  const parts = [];
  let cur = categoryById(catId);
  const guard = new Set();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    parts.unshift({ id: cur.id, name: cur.name });
    cur = cur.parentId ? categoryById(cur.parentId) : null;
  }
  return parts;
}

/** 某分类(含子孙)下指定分组的全部条目,用于树内统计 */
export function itemsInCategoryTreeAndGroup(catId, group) {
  const types = TYPE_GROUPS[group] || [];
  if (catId === 'all') return state.items.filter((i) => types.includes(i.type));
  const ids = new Set([catId, ...getCategoryDescendants(catId)]);
  return state.items.filter((i) => ids.has(i.categoryId) && types.includes(i.type));
}

// ---------------- 设置快捷方法 ----------------

export function setResourceTab(tab) {
  state.settings.resourceTab = tab;
  saveState();
}

export function setListViewMode(mode) {
  state.settings.listViewMode = mode;
  saveState();
}

export function setListSort(by, dir) {
  state.settings.listSortBy = by;
  state.settings.listSortDir = dir;
  saveState();
}

// ---------------- 场景管理(分类 + 场景条目) ----------------

/** 新增场景分类(支持子分类) */
export function addSceneCategory({ name, remark = '', parentId = '' }) {
  const cat = {
    id: uid('sc'),
    name,
    remark,
    parentId: parentId || '',
    sort: state.sceneCategories.length,
    createdAt: now(),
  };
  state.sceneCategories.push(cat);
  saveState();
  return cat;
}

export function updateSceneCategory(id, patch) {
  const cat = state.sceneCategories.find((c) => c.id === id);
  if (!cat) return null;
  Object.assign(cat, patch, { updatedAt: now() });
  saveState();
  return cat;
}

/** 删除场景分类:子分类提升到被删分类的父级,场景条目移到「未分类」(categoryId='') */
export function removeSceneCategory(id) {
  const cat = state.sceneCategories.find((c) => c.id === id);
  if (!cat) return;
  const parentPid = cat.parentId || '';
  state.sceneCategories = state.sceneCategories.filter((c) => c.id !== id);
  for (const c of state.sceneCategories) {
    if (c.parentId === id) c.parentId = parentPid;
  }
  for (const s of state.scenes) {
    if (s.categoryId === id) s.categoryId = '';
  }
  saveState();
}

export function sceneCategoryById(id) {
  return state.sceneCategories.find((c) => c.id === id) || null;
}

/** 场景分类的直接子分类(按数组顺序,即渲染顺序) */
export function getSceneCategoryChildren(parentId) {
  const pid = parentId || '';
  return state.sceneCategories.filter((c) => (c.parentId || '') === pid);
}

export function getSceneCategoryDescendants(catId) {
  const out = [];
  const collect = (pid) => {
    for (const c of state.sceneCategories) {
      if ((c.parentId || '') === pid) {
        out.push(c.id);
        collect(c.id);
      }
    }
  };
  collect(catId);
  return out;
}

/** 拖动排序场景分类 */
export function reorderSceneCategory(fromId, toId, place = 'before') {
  const fromIdx = state.sceneCategories.findIndex((c) => c.id === fromId);
  if (fromIdx < 0) return null;
  const [moved] = state.sceneCategories.splice(fromIdx, 1);
  let toIdx = state.sceneCategories.findIndex((c) => c.id === toId);
  if (toIdx < 0) toIdx = state.sceneCategories.length;
  if (place === 'after') toIdx += 1;
  state.sceneCategories.splice(toIdx, 0, moved);
  state.sceneCategories.forEach((c, i) => { c.sort = i; });
  saveState();
  return moved;
}

/** 新增场景条目;type: 'folder' | 'file';subtype: '' | 'fgui'(FGUI 界面包登记) */
export function addScene({ categoryId = '', name, filePath, type = 'folder', subtype = '', remark = '', tags = [], size = null, mtime = null, fguiSnapshots = [] }) {
  const scene = {
    id: uid('sn'),
    categoryId: categoryId || '',
    name,
    filePath: filePath || '',
    type,
    subtype: subtype || '',
    remark: remark || '',
    tags: cleanTags(tags),
    size,
    mtime,
    fguiSnapshots: Array.isArray(fguiSnapshots) ? fguiSnapshots : [],
    createdAt: now(),
  };
  state.scenes.push(scene);
  saveState();
  return scene;
}

export function updateScene(id, patch) {
  const s = state.scenes.find((x) => x.id === id);
  if (!s) return null;
  if (patch.tags) patch.tags = cleanTags(patch.tags);
  Object.assign(s, patch, { updatedAt: now() });
  saveState();
  return s;
}

export function removeScene(id) {
  state.scenes = state.scenes.filter((s) => s.id !== id);
  saveState();
}

export function sceneById(id) {
  return state.scenes.find((s) => s.id === id) || null;
}

/** 按文件路径精确匹配场景条目(FGUI 包登记查重用),返回第一个或 null */
export function findSceneByFilePath(fp) {
  if (!fp) return null;
  const norm = String(fp).replace(/\\/g, '/');
  return state.scenes.find((s) => String(s.filePath || '').replace(/\\/g, '/') === norm) || null;
}

/** 某分类(含未分类 '')下的直属场景条目 */
export function scenesInCategory(catId) {
  const target = catId === 'all' ? null : (catId || '');
  return state.scenes.filter((s) => (catId === 'all') || (s.categoryId || '') === target);
}

// ---------------- 网址收藏夹(网络资源抓取) ----------------

/** 新增网址收藏夹分类(可嵌套: parentId 指向父分类, '' = 顶级) */
export function addWebBookmarkCategory({ name, remark = '', parentId = '' }) {
  const cat = {
    id: uid('wbc'),
    name,
    remark,
    parentId: parentId || '',
    sort: state.webBookmarkCategories.length,
    createdAt: now(),
  };
  state.webBookmarkCategories.push(cat);
  saveState();
  return cat;
}

export function updateWebBookmarkCategory(id, patch) {
  const cat = state.webBookmarkCategories.find((c) => c.id === id);
  if (!cat) return null;
  Object.assign(cat, patch, { updatedAt: now() });
  saveState();
  return cat;
}

export function webBookmarkCategoryById(id) {
  return state.webBookmarkCategories.find((c) => c.id === id) || null;
}

/** 某分类的直接子分类(按数组顺序,即渲染顺序) */
export function getWebBookmarkCategoryChildren(parentId) {
  const pid = parentId || '';
  return state.webBookmarkCategories.filter((c) => (c.parentId || '') === pid);
}

/** 删除分类:子分类提升到被删分类的父级,网址条目移到「未分类」(categoryId='') */
export function removeWebBookmarkCategory(id) {
  const cat = state.webBookmarkCategories.find((c) => c.id === id);
  if (!cat) return;
  const parentPid = cat.parentId || '';
  state.webBookmarkCategories = state.webBookmarkCategories.filter((c) => c.id !== id);
  for (const c of state.webBookmarkCategories) {
    if (c.parentId === id) c.parentId = parentPid;
  }
  for (const b of state.webBookmarks) {
    if (b.categoryId === id) b.categoryId = parentPid; // 网址提升到父分类(无未分类概念)
  }
  saveState();
}

/** 新增网址收藏条目 */
export function addWebBookmark({ categoryId = '', name, url, remark = '' }) {
  const bm = {
    id: uid('wbm'),
    categoryId: categoryId || '',
    name: name || url,
    url: url || '',
    remark,
    createdAt: now(),
  };
  state.webBookmarks.push(bm);
  saveState();
  return bm;
}

export function updateWebBookmark(id, patch) {
  const bm = state.webBookmarks.find((b) => b.id === id);
  if (!bm) return null;
  Object.assign(bm, patch, { updatedAt: now() });
  saveState();
  return bm;
}

export function removeWebBookmark(id) {
  state.webBookmarks = state.webBookmarks.filter((b) => b.id !== id);
  saveState();
}

export function webBookmarkById(id) {
  return state.webBookmarks.find((b) => b.id === id) || null;
}

/** 某分类(含未分类 '')下的网址收藏条目 */
export function webBookmarksInCategory(catId) {
  const target = catId === 'all' ? null : (catId || '');
  return state.webBookmarks.filter((b) => (catId === 'all') || (b.categoryId || '') === target);
}

// ---------------- 开发工具箱:API 管理 ----------------
// 三级模型: apiCategories(分类树,可嵌套) → apiProjects(项目,挂在分类下) → apiEndpoints(API 数据字典,挂在项目下)

/** 新增 API 分类(可嵌套: parentId 指向父分类, '' = 顶级) */
export function addApiCategory({ name, remark = '', parentId = '' }) {
  const cat = {
    id: uid('apc'),
    name,
    remark,
    parentId: parentId || '',
    sort: state.apiCategories.length,
    createdAt: now(),
    updatedAt: now(),
  };
  state.apiCategories.push(cat);
  saveState();
  return cat;
}

export function updateApiCategory(id, patch) {
  const cat = state.apiCategories.find((c) => c.id === id);
  if (!cat) return null;
  Object.assign(cat, patch, { updatedAt: now() });
  saveState();
  return cat;
}

export function apiCategoryById(id) {
  return state.apiCategories.find((c) => c.id === id) || null;
}

/** 某分类的直接子分类(按数组顺序,即渲染顺序) */
export function getApiCategoryChildren(parentId) {
  const pid = parentId || '';
  return state.apiCategories.filter((c) => (c.parentId || '') === pid);
}

/** 删除 API 分类:子分类提升到被删分类的父级,项目移到「未分类」(categoryId='') */
export function removeApiCategory(id) {
  const cat = state.apiCategories.find((c) => c.id === id);
  if (!cat) return;
  const parentPid = cat.parentId || '';
  state.apiCategories = state.apiCategories.filter((c) => c.id !== id);
  for (const c of state.apiCategories) {
    if (c.parentId === id) c.parentId = parentPid;
  }
  for (const p of state.apiProjects) {
    if (p.categoryId === id) p.categoryId = '';
  }
  saveState();
}

/** 新增 API 项目(挂在分类下) */
export function addApiProject({ categoryId = '', name, baseUrl = '', remark = '' }) {
  const proj = {
    id: uid('app'),
    categoryId: categoryId || '',
    name: name || '未命名项目',
    baseUrl: baseUrl || '',
    remark,
    sort: state.apiProjects.length,
    createdAt: now(),
    updatedAt: now(),
  };
  state.apiProjects.push(proj);
  saveState();
  return proj;
}

export function updateApiProject(id, patch) {
  const proj = state.apiProjects.find((p) => p.id === id);
  if (!proj) return null;
  Object.assign(proj, patch, { updatedAt: now() });
  saveState();
  return proj;
}

export function apiProjectById(id) {
  return state.apiProjects.find((p) => p.id === id) || null;
}

/** 某分类(含未分类 ''/'all')下的 API 项目 */
export function apiProjectsInCategory(catId) {
  const target = catId === 'all' ? null : (catId || '');
  return state.apiProjects.filter((p) => (catId === 'all') || (p.categoryId || '') === target);
}

/** 删除 API 项目:同时删除其下全部数据字典接口 */
export function removeApiProject(id) {
  state.apiProjects = state.apiProjects.filter((p) => p.id !== id);
  state.apiEndpoints = state.apiEndpoints.filter((e) => e.projectId !== id);
  saveState();
}

/** 新增 API 数据字典接口(挂在项目下) */
export function addApiEndpoint({ projectId, name = '', method = 'GET', path = '', desc = '', params = [], headers = [], body = '', response = '' }) {
  const ep = {
    id: uid('ape'),
    projectId: projectId || '',
    name: name || '未命名接口',
    method: (method || 'GET').toUpperCase(),
    path: path || '',
    desc: desc || '',
    params: Array.isArray(params) ? params : [],
    headers: Array.isArray(headers) ? headers : [],
    body: body || '',
    response: response || '',
    sort: state.apiEndpoints.length,
    createdAt: now(),
    updatedAt: now(),
  };
  state.apiEndpoints.push(ep);
  saveState();
  return ep;
}

export function updateApiEndpoint(id, patch) {
  const ep = state.apiEndpoints.find((e) => e.id === id);
  if (!ep) return null;
  if (patch.method) patch.method = String(patch.method).toUpperCase();
  Object.assign(ep, patch, { updatedAt: now() });
  saveState();
  return ep;
}

export function apiEndpointById(id) {
  return state.apiEndpoints.find((e) => e.id === id) || null;
}

/** 某项目下的数据字典接口 */
export function apiEndpointsInProject(projectId) {
  return state.apiEndpoints.filter((e) => e.projectId === projectId);
}

// ================= 资源工具箱目录树 =================
// 节点:toolId 为空 → 目录(可含子目录/工具链接);toolId 非空 → 内置工具链接。
// 与动画资源分类树同构,但叶子是「工具」而非「动画条目」。

/** 首次启动(或旧库无数据)注入默认工具箱目录结构 */
function seedToolboxFolders() {
  if (state.toolboxFolders.length) return;
  const conv = addToolboxFolder({ name: '文件格式转换', parentId: '', toolId: '' });
  addToolboxFolder({ name: 'astc 转 png', parentId: conv.id, toolId: 'astc2png' });
  addToolboxFolder({ name: 'skel 转 json', parentId: conv.id, toolId: 'skel2json' });
  addToolboxFolder({ name: 'spine 文件修复', parentId: conv.id, toolId: 'spinefix' });
  addToolboxFolder({ name: 'Laya .sk 转 Spine', parentId: conv.id, toolId: 'sk2spine' });
  addToolboxFolder({ name: 'spine 格式转换', parentId: conv.id, toolId: 'spineconvert' });
  addToolboxFolder({ name: '图片集打包', parentId: '', toolId: 'atlas' });
  addToolboxFolder({ name: '图片编辑', parentId: '', toolId: 'imageedit' });
  addToolboxFolder({ name: 'FGUI导出源', parentId: '', toolId: 'fgui' });
  addToolboxFolder({ name: 'FGUI编辑器', parentId: '', toolId: '__fgui_editor__' });
}

export function toolboxFolderById(id) {
  return state.toolboxFolders.find((f) => f.id === id) || null;
}

/** 某父级下的直接子节点(目录 + 工具链接),按数组顺序(即 sort 顺序)返回 */
export function getToolboxChildren(parentId) {
  const pid = parentId || '';
  return state.toolboxFolders.filter((f) => (f.parentId || '') === pid);
}

/** 某父级下的直接子目录(仅 toolId 为空的节点) */
export function getToolboxFolderChildren(parentId) {
  const pid = parentId || '';
  return state.toolboxFolders.filter((f) => (f.parentId || '') === pid && !f.toolId);
}

export function isToolboxFolderDescendant(id, ancestorId) {
  let cur = toolboxFolderById(id);
  while (cur && cur.parentId) {
    if (cur.parentId === ancestorId) return true;
    cur = toolboxFolderById(cur.parentId);
  }
  return false;
}

/** 某目录的所有后代目录 id(不含自身,仅目录节点) */
export function getToolboxFolderDescendants(id) {
  const out = [];
  const collect = (pid) => {
    for (const f of state.toolboxFolders) {
      if ((f.parentId || '') === pid && !f.toolId) {
        out.push(f.id);
        collect(f.id);
      }
    }
  };
  collect(id);
  return out;
}

/** 目录路径名,如「文件格式转换 / spine 格式转换」(用于移动对话框) */
export function toolboxFolderPath(id) {
  const parts = [];
  let cur = toolboxFolderById(id);
  while (cur) {
    parts.unshift(cur.name);
    cur = cur.parentId ? toolboxFolderById(cur.parentId) : null;
  }
  return parts.join(' / ');
}

/** 新增目录或工具链接;parentId '' = 顶级;icon 为自定义显示图标(emoji,空 = 默认) */
export function addToolboxFolder({ name, parentId = '', toolId = '', icon = '' }) {
  const f = {
    id: uid('tf'),
    name,
    parentId: parentId || '',
    toolId: toolId || '',
    icon: icon || '',
    sort: state.toolboxFolders.length,
    createdAt: now(),
    updatedAt: now(),
  };
  state.toolboxFolders.push(f);
  saveState();
  return f;
}

export function updateToolboxFolder(id, patch) {
  const f = toolboxFolderById(id);
  if (!f) return null;
  Object.assign(f, patch, { updatedAt: now() });
  saveState();
  return f;
}

/**
 * 删除目录:递归删除其下全部子目录;其下工具链接(内置工具)提升到被删目录的父级,
 * 避免删除后内置工具从侧栏消失(仍可在工具箱主页访问)。
 */
export function removeToolboxFolder(id) {
  const f = toolboxFolderById(id);
  if (!f || f.toolId) return; // 工具链接不可直接删除(用移动代替)
  const parentPid = f.parentId || '';
  const desc = getToolboxFolderDescendants(id);
  const folderIds = new Set([id, ...desc]);
  // 工具链接提升到被删目录的父级
  for (const x of state.toolboxFolders) {
    if (x.toolId && folderIds.has(x.parentId)) x.parentId = parentPid;
  }
  // 删除目录及其子孙目录
  state.toolboxFolders = state.toolboxFolders.filter((x) => !folderIds.has(x.id));
  saveState();
}

/** 拖动排序:把 fromId 移到 toId 的上方(before)或下方(after),数组顺序即渲染顺序 */
export function reorderToolboxFolder(fromId, toId, place = 'before') {
  const fromIdx = state.toolboxFolders.findIndex((f) => f.id === fromId);
  if (fromIdx < 0) return null;
  const [moved] = state.toolboxFolders.splice(fromIdx, 1);
  let toIdx = state.toolboxFolders.findIndex((f) => f.id === toId);
  if (toIdx < 0) toIdx = state.toolboxFolders.length;
  if (place === 'after') toIdx += 1;
  state.toolboxFolders.splice(toIdx, 0, moved);
  state.toolboxFolders.forEach((f, i) => { f.sort = i; });
  saveState();
  return moved;
}

/**
 * 跨目录拖拽:把 fromId 挪到 targetId 的同级并落在其上方(before)/下方(after)。
 * 与 reorderToolboxFolder 的区别:会同步把 parentId 改成目标节点的父级,
 * 因此「拖到别的目录里的某个节点旁边」也能一步完成(移动 + 定位)。
 */
export function moveToolboxNodeBeside(fromId, targetId, place = 'before') {
  const target = toolboxFolderById(targetId);
  if (!target) return null;
  const fromIdx = state.toolboxFolders.findIndex((f) => f.id === fromId);
  if (fromIdx < 0) return null;
  const [moved] = state.toolboxFolders.splice(fromIdx, 1);
  moved.parentId = target.parentId || '';
  moved.updatedAt = now();
  let toIdx = state.toolboxFolders.findIndex((f) => f.id === targetId);
  if (toIdx < 0) toIdx = state.toolboxFolders.length;
  if (place === 'after') toIdx += 1;
  state.toolboxFolders.splice(toIdx, 0, moved);
  state.toolboxFolders.forEach((f, i) => { f.sort = i; });
  saveState();
  return moved;
}

/**
 * 把节点移动到某目录下的末尾;parentId '' = 工具箱根目录。
 * 用于「拖到目录中部」与「拖到顶层模块节点(资源工具箱)」两种放置。
 */
export function moveToolboxNodeToParent(id, parentId = '') {
  const pid = parentId || '';
  const fromIdx = state.toolboxFolders.findIndex((f) => f.id === id);
  if (fromIdx < 0) return null;
  const [moved] = state.toolboxFolders.splice(fromIdx, 1);
  moved.parentId = pid;
  moved.updatedAt = now();
  // 插到该父级现有最后一个子节点之后(渲染顺序 = 数组顺序,只在同父级内比较)
  let insertAt = state.toolboxFolders.length;
  for (let i = state.toolboxFolders.length - 1; i >= 0; i--) {
    if ((state.toolboxFolders[i].parentId || '') === pid) { insertAt = i + 1; break; }
  }
  state.toolboxFolders.splice(insertAt, 0, moved);
  state.toolboxFolders.forEach((f, i) => { f.sort = i; });
  saveState();
  return moved;
}


// ================= 侧栏菜单管理(整棵侧栏菜单树) =================
// 节点:nodeType 'dir' 目录(可嵌套,含子节点) | 'term' 终端(点击后打开页面/调用外部程序)。
// actionType:''(目录) | 'builtin' 内置动作 | 'exe' 外部程序。
// 内置目录 action: fav / res:anim / res:image / res:audio / res:3d / scene / webgame / toolbox / devtools
// 内置终端 action: page:settings / page:api / page:webgame / page:scene / page:toolbox / page:fav / tool:<toolId>
// 用户目录:nodeType 'dir' + actionType '';用户终端:nodeType 'term' + actionType 'builtin'/'exe'。

/** 侧栏菜单树的默认结构(首次启动或旧库无数据时注入) */
const MENU_DEFAULT = [
  { id: '__m_fav__', name: '收藏夹', icon: '🔖', nodeType: 'dir', actionType: 'builtin', action: 'fav', tooltip: '收藏夹主页与收藏分类', note: '' },
  { id: '__m_res_anim__', name: '动画资源', icon: '🎬', nodeType: 'dir', actionType: 'builtin', action: 'res:anim', tooltip: 'Spine / DragonBones 骨骼动画', note: '', isResource: true },
  { id: '__m_res_image__', name: '图片资源', icon: '🖼', nodeType: 'dir', actionType: 'builtin', action: 'res:image', tooltip: '图片资源', note: '', isResource: true },
  { id: '__m_res_audio__', name: '音频资源', icon: '♪', nodeType: 'dir', actionType: 'builtin', action: 'res:audio', tooltip: '音频资源', note: '', isResource: true },
  { id: '__m_res_3d__', name: '3D资源', icon: '🧊', nodeType: 'dir', actionType: 'builtin', action: 'res:3d', tooltip: '3D 模型资源', note: '', isResource: true },
  { id: '__m_scene__', name: '游戏场景管理', icon: '🎬', nodeType: 'dir', actionType: 'builtin', action: 'scene', tooltip: '场景分类与 FGUI 包管理', note: '' },
  { id: '__m_webgame__', name: '网络资源抓取', icon: '🌐', nodeType: 'dir', actionType: 'builtin', action: 'webgame', tooltip: '内嵌浏览器逆向分析网络资源', note: '' },
  { id: '__m_toolbox__', name: '资源工具箱', icon: '🧰', nodeType: 'dir', actionType: 'builtin', action: 'toolbox', tooltip: '格式转换 / 图片编辑 / FGUI 等工具', note: '' },
  { id: '__m_devtools__', name: '开发工具箱', icon: '🛠', nodeType: 'dir', actionType: 'builtin', action: 'devtools', tooltip: '开发辅助工具', note: '' },
  { id: '__m_settings__', name: '系统设置', icon: '⚙', nodeType: 'term', actionType: 'builtin', action: 'page:settings', tooltip: '打开系统设置', note: '' },
];

/** 资源目录名称:这些目录及其所有子孙目录的资源属性标识默认 = 是 */
const RESOURCE_DIR_NAMES = ['动画资源', '图片资源', '图标库资源', '音频资源', '3D资源', '项目管理'];

/**
 * 由目录名称 + 祖先链推导某节点是否为资源目录。
 * 自身或任一祖先名称命中 RESOURCE_DIR_NAMES 即视为资源目录(与已存储的 isResource 无关,用于旧库迁移)。
 */
function computeIsResource(node, allNodes) {
  const byId = (id) => (allNodes || state.menuNodes).find((m) => m.id === id);
  let cur = node;
  while (cur) {
    if (RESOURCE_DIR_NAMES.includes(cur.name)) return true;
    cur = cur.parentId ? byId(cur.parentId) : null;
  }
  return false;
}

function seedMenuNodes() {
  if (state.menuNodes.length) return;
  for (const m of MENU_DEFAULT) {
    state.menuNodes.push({
      ...m,
      parentId: '',
      sort: state.menuNodes.length,
      createdAt: now(),
      updatedAt: now(),
    });
  }
  // 开发工具箱默认含「API 管理」终端子节点
  state.menuNodes.push({
    id: '__m_api__', name: 'API 管理', icon: '📖', parentId: '__m_devtools__',
    nodeType: 'term', actionType: 'builtin', action: 'page:api',
    tooltip: '内嵌 API 参考文档', note: '', sort: state.menuNodes.length, createdAt: now(), updatedAt: now(),
  });
  saveState();
}

export function menuNodeById(id) {
  return state.menuNodes.find((m) => m.id === id) || null;
}

/** 某父级下的直接子节点(按数组顺序 = sort 顺序) */
export function getMenuChildren(parentId) {
  const pid = parentId || '';
  return state.menuNodes.filter((m) => (m.parentId || '') === pid);
}

/** 顶级菜单节点(按 sort 顺序) */
export function getMenuRoots() {
  return getMenuChildren('');
}

export function isMenuNodeDescendant(id, ancestorId) {
  let cur = menuNodeById(id);
  while (cur && cur.parentId) {
    if (cur.parentId === ancestorId) return true;
    cur = menuNodeById(cur.parentId);
  }
  return false;
}

/** 某目录的所有后代 id(不含自身) */
export function getMenuNodeDescendants(id) {
  const out = [];
  const collect = (pid) => {
    for (const m of state.menuNodes) {
      if ((m.parentId || '') === pid) { out.push(m.id); collect(m.id); }
    }
  };
  collect(id);
  return out;
}

/** 节点路径名(用于移动对话框),如「资源工具箱 / 文件格式转换」 */
export function menuNodePath(id) {
  const parts = [];
  let cur = menuNodeById(id);
  while (cur) { parts.unshift(cur.name); cur = cur.parentId ? menuNodeById(cur.parentId) : null; }
  return parts.join(' / ');
}

/** 新增菜单节点(目录或终端);parentId '' = 顶级 */
export function addMenuNode({ name, icon = '', parentId = '', nodeType = 'dir', actionType = '', action = '', tooltip = '', note = '', typeTags = [], isResource = false }) {
  const node = {
    id: uid('mn'),
    name,
    icon: icon || '',
    parentId: parentId || '',
    nodeType: nodeType === 'term' ? 'term' : 'dir',
    actionType: actionType || '',
    action: action || '',
    tooltip: tooltip || '',
    note: note || '',
    typeTags: Array.isArray(typeTags) ? typeTags.filter((t) => isValidTypeTag(t)) : [],
    isResource: !!isResource,
    sort: state.menuNodes.length,
    createdAt: now(),
    updatedAt: now(),
  };
  state.menuNodes.push(node);
  saveState();
  return node;
}

export function updateMenuNode(id, patch) {
  const n = menuNodeById(id);
  if (!n) return null;
  Object.assign(n, patch, { updatedAt: now() });
  saveState();
  return n;
}

/** 删除菜单节点:递归删除其全部子节点(终端节点直接删除) */
export function removeMenuNode(id) {
  const ids = new Set([id, ...getMenuNodeDescendants(id)]);
  state.menuNodes = state.menuNodes.filter((m) => !ids.has(m.id));
  saveState();
}

/** 拖动排序:把 fromId 移到 toId 的上方(before)或下方(after) */
export function reorderMenuNode(fromId, toId, place = 'before') {
  const fromIdx = state.menuNodes.findIndex((m) => m.id === fromId);
  if (fromIdx < 0) return null;
  const [moved] = state.menuNodes.splice(fromIdx, 1);
  let toIdx = state.menuNodes.findIndex((m) => m.id === toId);
  if (toIdx < 0) toIdx = state.menuNodes.length;
  if (place === 'after') toIdx += 1;
  state.menuNodes.splice(toIdx, 0, moved);
  state.menuNodes.forEach((m, i) => { m.sort = i; });
  saveState();
  return moved;
}

/** 跨目录拖拽:把 fromId 挪到 targetId 的同级并落在其前/后(同步改 parentId) */
export function moveMenuNodeBeside(fromId, targetId, place = 'before') {
  const target = menuNodeById(targetId);
  if (!target) return null;
  const fromIdx = state.menuNodes.findIndex((m) => m.id === fromId);
  if (fromIdx < 0) return null;
  const [moved] = state.menuNodes.splice(fromIdx, 1);
  moved.parentId = target.parentId || '';
  moved.updatedAt = now();
  let toIdx = state.menuNodes.findIndex((m) => m.id === targetId);
  if (toIdx < 0) toIdx = state.menuNodes.length;
  if (place === 'after') toIdx += 1;
  state.menuNodes.splice(toIdx, 0, moved);
  state.menuNodes.forEach((m, i) => { m.sort = i; });
  saveState();
  return moved;
}

/** 把节点移动到某目录末尾;parentId '' = 顶级 */
export function moveMenuNodeToParent(id, parentId = '') {
  const pid = parentId || '';
  const fromIdx = state.menuNodes.findIndex((m) => m.id === id);
  if (fromIdx < 0) return null;
  const [moved] = state.menuNodes.splice(fromIdx, 1);
  moved.parentId = pid;
  moved.updatedAt = now();
  let insertAt = state.menuNodes.length;
  for (let i = state.menuNodes.length - 1; i >= 0; i--) {
    if ((state.menuNodes[i].parentId || '') === pid) { insertAt = i + 1; break; }
  }
  state.menuNodes.splice(insertAt, 0, moved);
  state.menuNodes.forEach((m, i) => { m.sort = i; });
  saveState();
  return moved;
}


export function removeApiEndpoint(id) {
  state.apiEndpoints = state.apiEndpoints.filter((e) => e.id !== id);
  saveState();
}

// ================= 图标库(节点图标:emoji 或 PNG dataURL) =================

/** icon 是否为图片(dataURL)图标 */
export function isImageIcon(icon) {
  return typeof icon === 'string' && icon.startsWith('data:image');
}

/** 是否为 URL(网址):协议名 + :// 开头 */
export function isUrlPath(p) {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(String(p || '').trim());
}

/** 是否为本地网页:file:// 开头,或本地文件且扩展名为 html/htm/xhtml */
export function isLocalHtmlPath(p) {
  const s = String(p || '').trim();
  if (!s) return false;
  if (/^file:\/\//i.test(s)) return true;
  if (isUrlPath(s)) return false; // 其它协议(http/https 等)不是本地
  return /\.(html?|xhtml)$/i.test(s);
}

/** 把本地文件路径转 file:// URL(已有协议则原样返回) */
export function toFileUrl(p) {
  const s = String(p || '').trim();
  if (!s) return '';
  if (isUrlPath(s)) return s;
  return 'file:///' + s.replace(/\\/g, '/').replace(/^\/+/, '');
}

/** 从程序路径/网址提取自动名称:本地文件取文件名(去扩展名);网址取主机名(去 www.) */
export function nameFromPath(p) {
  const s = String(p || '').trim();
  if (!s) return '';
  if (isUrlPath(s)) {
    try { return (new URL(s).hostname || '').replace(/^www\./, ''); }
    catch (_) { return ''; }
  }
  const base = s.split(/[\\/]/).pop() || '';
  return base.replace(/\.[^.]+$/, '');
}

export function getIconGroups() {
  return Array.isArray(state.settings.iconGroups) ? state.settings.iconGroups : [];
}
export function getIconItems() {
  return Array.isArray(state.settings.iconItems) ? state.settings.iconItems : [];
}
function commitIconLib() {
  setSetting('iconGroups', getIconGroups());
  setSetting('iconItems', getIconItems());
}

/** 新增分组 */
export function addIconGroup(name) {
  const n = String(name || '').trim();
  if (!n) return null;
  const groups = getIconGroups();
  const g = { id: uid('ig'), name: n, sort: groups.length };
  groups.push(g);
  commitIconLib();
  return g;
}
export function renameIconGroup(id, name) {
  const n = String(name || '').trim();
  if (!n) return;
  const g = getIconGroups().find((x) => x.id === id);
  if (!g) return;
  g.name = n;
  commitIconLib();
}
/** 删除分组:组内图标移到第一组(无组则自动建「未分组」) */
export function removeIconGroup(id) {
  const groups = getIconGroups();
  const idx = groups.findIndex((x) => x.id === id);
  if (idx < 0) return;
  groups.splice(idx, 1);
  groups.forEach((x, i) => { x.sort = i; });
  const items = getIconItems();
  const moved = items.filter((it) => it.groupId === id);
  if (moved.length) {
    let target = groups[0];
    if (!target) target = addIconGroup('未分组');
    for (const it of moved) it.groupId = target.id;
  }
  commitIconLib();
}

/** 新增图标;icon 为 emoji 或 data:image dataURL */
export function addIconItem({ groupId = '', name = '', icon = '' }) {
  if (!icon) return null;
  const items = getIconItems();
  const sameGroup = items.filter((it) => it.groupId === groupId);
  const it = {
    id: uid('ii'),
    groupId: groupId || '',
    name: String(name || '').trim(),
    icon,
    sort: sameGroup.length ? Math.max(...sameGroup.map((x) => x.sort)) + 1 : 0,
  };
  items.push(it);
  commitIconLib();
  return it;
}
export function removeIconItem(id) {
  const items = getIconItems();
  const i = items.findIndex((x) => x.id === id);
  if (i < 0) return;
  items.splice(i, 1);
  commitIconLib();
}
/** 组内上移/下移(dir=-1 上移,+1 下移) */
export function moveIconItem(id, dir) {
  const items = getIconItems();
  const idx = items.findIndex((x) => x.id === id);
  if (idx < 0) return false;
  const it = items[idx];
  let j = idx + dir;
  while (j >= 0 && j < items.length && items[j].groupId !== it.groupId) j += dir;
  if (j < 0 || j >= items.length) return false;
  [items[idx], items[j]] = [items[j], items[idx]];
  items.forEach((x, i) => { x.sort = i; });
  commitIconLib();
  return true;
}
/** 拖拽排序:把 fromId 移到 toId 的上方(before)或下方(after);跨组拖拽时自动切换 groupId */
export function reorderIconItem(fromId, toId, place = 'before') {
  const items = getIconItems();
  const fromIdx = items.findIndex((x) => x.id === fromId);
  if (fromIdx < 0) return false;
  const [moved] = items.splice(fromIdx, 1);
  let toIdx = items.findIndex((x) => x.id === toId);
  if (toIdx < 0) {
    items.push(moved);
  } else {
    const target = items[toIdx];
    if (target.groupId !== moved.groupId) moved.groupId = target.groupId;
    if (place === 'after') toIdx += 1;
    items.splice(Math.min(toIdx, items.length), 0, moved);
  }
  items.forEach((x, i) => { x.sort = i; });
  commitIconLib();
  return true;
}
/** 更新图标(名称/图标);icon 为 emoji 或 data:image dataURL */
export function updateIconItem(id, patch) {
  const items = getIconItems();
  const it = items.find((x) => x.id === id);
  if (!it) return null;
  if (patch.name !== undefined) it.name = String(patch.name || '').trim();
  if (patch.icon !== undefined && patch.icon) it.icon = patch.icon;
  if (patch.groupId !== undefined) it.groupId = patch.groupId || '';
  commitIconLib();
  return it;
}

/** emoji 图标字符归一化(去变体选择符 U+FE0F),用于去重匹配 */
function iconEmojiKey(e) {
  return String(e || '').replace(/️/g, '');
}

/**
 * 把默认 emoji 图标库(DEFAULT_ICON_LIBRARY)合并进用户当前图标库:
 * - 各默认分类按名称查找,不存在则新建;
 * - 每个 emoji 在「当前分类」与「全局」范围内按归一化字符去重,缺失才补入;
 * - 顺带清理当前图标库内已存在的重复 emoji(保留排序最前者)。
 * 在 loadState 中调用一次,保证老用户也能补齐新增的 emoji 且不产生重复。
 */
export function mergeDefaultIconLibrary() {
  const groups = getIconGroups();
  const items = getIconItems();
  let changed = false;

  // 全局去重:删除同一 emoji(归一化)的重复条目,保留排序最前的一个
  const seen = new Map();
  for (const it of items) {
    if (isImageIcon(it.icon)) continue;
    const k = iconEmojiKey(it.icon);
    if (seen.has(k)) it.__dup = true;
    else seen.set(k, it.id);
  }
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].__dup) { items.splice(i, 1); changed = true; }
  }

  for (const d of DEFAULT_ICON_LIBRARY) {
    let g = groups.find((x) => x.name === d.group);
    if (!g) {
      g = { id: uid('ig'), name: d.group, sort: groups.length };
      groups.push(g);
      changed = true;
    }
    const inGroup = items.filter((it) => it.groupId === g.id);
    const keys = new Set(inGroup.map((it) => iconEmojiKey(it.icon)));
    let sort = inGroup.length ? Math.max(...inGroup.map((x) => x.sort || 0)) + 1 : 0;
    for (const e of d.items) {
      const k = iconEmojiKey(e);
      if (keys.has(k) || seen.has(k)) continue; // 本组或全局已存在 → 跳过,不重复
      items.push({ id: uid('ii'), groupId: g.id, name: EMOJI_NAMES[k] || '', icon: e, sort: sort++ });
      keys.add(k);
      seen.set(k, true); // seen 是 Map(存 首次出现条目 id),补新条目时同步登记,防后续分组重复添加
      changed = true;
    }
  }

  if (changed) {
    items.forEach((x, i) => { x.sort = i; });
    commitIconLib();
    saveState();
  }
}

// ================= 自定义页面(终端节点目标页面) =================

/** 页面模板:基于模板建立自定义页面 */
export const PAGE_TEMPLATES = [
  { id: 'web', name: '内嵌网页', desc: '点击在主显示区打开网页或本地 HTML(需填写网址)' },
  { id: 'note', name: '文本笔记', desc: '点击在主显示区显示可编辑的文本笔记' },
];

export function customPages() {
  return Array.isArray(state.settings.customPages) ? state.settings.customPages : [];
}

export function customPageById(id) {
  return customPages().find((x) => x.id === id) || null;
}

export function addCustomPage({ templateId = 'note', title = '', icon = '', url = '', content = '', note = '' }) {
  const p = {
    id: uid('pg'),
    templateId: PAGE_TEMPLATES.some((t) => t.id === templateId) ? templateId : 'note',
    title: String(title || '').trim() || '未命名页面',
    icon: icon || '',
    url: String(url || '').trim(),
    content: String(content || ''),
    note: String(note || ''),
    createdAt: now(),
    updatedAt: now(),
  };
  const arr = customPages();
  arr.push(p);
  setSetting('customPages', arr);
  return p;
}

export function updateCustomPage(id, patch) {
  const p = customPageById(id);
  if (!p) return null;
  Object.assign(p, patch, { updatedAt: now() });
  setSetting('customPages', customPages());
  return p;
}

export function removeCustomPage(id) {
  const arr = customPages();
  const i = arr.findIndex((x) => x.id === id);
  if (i < 0) return;
  arr.splice(i, 1);
  setSetting('customPages', arr);
}
