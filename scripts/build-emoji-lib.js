// 一次性脚本:根据官方 Unicode 17.0 分类体系重建内置 emoji 图标库
// 生成 DEFAULT_ICON_LIBRARY + EMOJI_NAMES 并写回 src/state.js
// 同时做去重(按去掉 U+FE0F 变体选择符后的字符),保留首次出现的名称。
const fs = require('fs');
const path = require('path');

const STATE = path.resolve(__dirname, '..', 'src', 'state.js');
let src = fs.readFileSync(STATE, 'utf8');

// 每个分类:[emoji, 中文名, 英文名]
const CATS = {
  '笑脸与情感': [
    ['😀','咧嘴笑脸','Grinning Face'],['😃','大眼咧嘴笑脸','Grinning Face with Big Eyes'],['😄','笑眼咧嘴笑脸','Grinning Face with Smiling Eyes'],
    ['😁','喜笑颜开脸','Beaming Face with Smiling Eyes'],['😆','眯眼笑','Grinning Squinting Face'],['😅','苦笑冒汗','Grinning Face with Sweat'],
    ['🤣','笑到打滚','Rolling on the Floor Laughing'],['😂','笑哭','Face with Tears of Joy'],['🙂','微笑脸','Slightly Smiling Face'],
    ['🙃','倒脸','Upside-Down Face'],['😉','眨眼脸','Winking Face'],['😊','笑眼微笑','Smiling Face with Smiling Eyes'],['😇','天使微笑','Smiling Face with Halo'],
    ['🥰','爱心微笑','Smiling Face with Hearts'],['😍','爱心眼','Smiling Face with Heart-Eyes'],['🤩','星星眼','Star-Struck'],
    ['😘','飞吻','Face Blowing a Kiss'],['😗','亲亲脸','Kissing Face'],['😚','闭眼亲亲','Kissing Face with Closed Eyes'],
    ['😙','笑眼亲亲','Kissing Face with Smiling Eyes'],['🥲','含泪微笑','Smiling Face with Tear'],
    ['😋','馋嘴脸','Face Savoring Food'],['😛','吐舌脸','Face with Tongue'],['😜','眨眼吐舌','Winking Face with Tongue'],
    ['🤪','滑稽脸','Zany Face'],['😝','眯眼吐舌','Squinting Face with Tongue'],['🤑','发财脸','Money-Mouth Face'],
    ['🤗','拥抱脸','Hugging Face'],['🤭','捂嘴笑','Face with Hand Over Mouth'],['🤫','嘘声脸','Shushing Face'],['🤔','思考脸','Thinking Face'],
    ['🤐','拉链嘴','Zipper-Mouth Face'],['🤨','挑眉脸','Face with Raised Eyebrow'],['😐','面无表情','Neutral Face'],['😑','无语脸','Expressionless Face'],
    ['😶','无嘴脸','Face Without Mouth'],['😏','得意笑','Smirking Face'],['😒','不爽脸','Unamused Face'],['🙄','翻白眼','Face with Rolling Eyes'],
    ['😬','龇牙脸','Grimacing Face'],['🤥','说谎脸','Lying Face'],['😌','松口气','Relieved Face'],['😔','沉思脸','Pensive Face'],
    ['😪','困脸','Sleepy Face'],['🤤','流口水','Drooling Face'],['😴','睡觉脸','Sleeping Face'],
    ['😷','口罩脸','Face with Medical Mask'],['🤒','发烧脸','Face with Thermometer'],['🤕','受伤脸','Face with Head-Bandage'],
    ['🤢','恶心脸','Nauseated Face'],['🤮','呕吐脸','Face Vomiting'],['🤧','打喷嚏','Sneezing Face'],['🥵','热脸','Hot Face'],
    ['🥶','冷脸','Cold Face'],['🥴','醉脸','Woozy Face'],['😵','晕脸','Knocked-Out Face'],['🤯','爆炸头','Exploding Head'],
    ['🤠','牛仔帽脸','Cowboy Hat Face'],['🥳','派对脸','Partying Face'],['🥸','伪装脸','Disguised Face'],['😎','墨镜脸','Smiling Face with Sunglasses'],
    ['🤓','书呆子脸','Nerd Face'],['🧐','单片眼镜','Face with Monocle'],
    ['😕','困惑脸','Confused Face'],['😟','担忧脸','Worried Face'],['🙁','微皱眉','Slightly Frowning Face'],['☹️','皱眉脸','Frowning Face'],
    ['😮','张嘴惊讶','Face with Open Mouth'],['😯','缄默惊讶','Hushed Face'],['😲','震惊脸','Astonished Face'],['😳','脸红脸','Flushed Face'],
    ['😨','害怕脸','Fearful Face'],['😰','冷汗焦虑','Anxious Face with Sweat'],['😥','失望释然','Sad but Relieved Face'],['😢','哭泣脸','Crying Face'],
    ['😭','嚎啕大哭','Loudly Crying Face'],['😱','尖叫恐惧','Face Screaming in Fear'],['😠','生气脸','Angry Face'],['😡','暴怒脸','Pouting Face'],
    ['🤬','咒骂脸','Face with Symbols on Mouth'],
    ['🤡','小丑脸','Clown Face'],['👹','食人魔','Ogre'],['👺','天狗','Goblin'],['👻','幽灵','Ghost'],['💀','骷髅','Skull'],['☠️','骷髅交叉骨','Skull and Crossbones'],
    ['🎃','南瓜灯','Jack-O-Lantern'],['😺','笑猫脸','Grinning Cat'],['😸','笑眼猫','Grinning Cat with Smiling Eyes'],['😻','爱心眼猫','Smiling Cat with Heart-Eyes'],
    ['🙈','非礼勿视','See-No-Evil Monkey'],['🙉','非礼勿听','Hear-No-Evil Monkey'],['🙊','非礼勿言','Speak-No-Evil Monkey'],
    ['❤️','红心','Red Heart'],['🧡','橙心','Orange Heart'],['💛','黄心','Yellow Heart'],['💚','绿心','Green Heart'],['💙','蓝心','Blue Heart'],
    ['💜','紫心','Purple Heart'],['🖤','黑心','Black Heart'],['🤍','白心','White Heart'],['💔','心碎','Broken Heart'],
    ['❤️‍🔥','烈火之心','Heart on Fire'],['❤️‍🩹','修复之心','Mending Heart'],['💕','两颗心','Two Hearts'],['💞','旋转爱心','Revolving Hearts'],
    ['💓','跳动的心','Beating Heart'],['💗','成长的心','Growing Heart'],['💖','闪亮爱心','Sparkling Heart'],['💘','丘比特之心','Heart with Arrow'],
    ['💝','礼物爱心','Heart with Ribbon'],['💋','唇印','Kiss Mark'],['💌','情书','Love Letter'],['💐','花束','Bouquet'],
  ],
  '人物与身体': [
    ['👋','挥手','Waving Hand'],['🤚','抬手','Raised Back of Hand'],['✋','手掌','Raised Hand'],['🖐️','五指张开','Hand with Fingers Splayed'],
    ['🖖','瓦肯举手礼','Vulcan Salute'],['👌','OK手势','OK Hand'],['🤌','捏手指','Pinched Fingers'],['🤏','捏一捏','Pinching Hand'],
    ['✌️','胜利手势','Victory Hand'],['🤞','交叉手指','Crossed Fingers'],['🤟','我爱你手势','Love-You Gesture'],['🤘','摇滚手势','Sign of the Horns'],
    ['👈','左指','Backhand Index Pointing Left'],['👉','右指','Backhand Index Pointing Right'],['👆','上指','Backhand Index Pointing Up'],
    ['👇','下指','Backhand Index Pointing Down'],['☝️','食指向上','Index Pointing Up'],['👍','点赞','Thumbs Up'],['👎','踩','Thumbs Down'],
    ['✊','拳头','Raised Fist'],['👊','出拳','Oncoming Fist'],['🤛','左拳','Left-Facing Fist'],['🤜','右拳','Right-Facing Fist'],
    ['👏','鼓掌','Clapping Hands'],['👐','张开双手','Open Hands'],['🤲','掌心向上','Palms Up Together'],['🙏','双手合十','Folded Hands'],
    ['💅','涂指甲','Nail Polish'],['💪','肌肉','Flexed Biceps'],['🦾','机械臂','Mechanical Arm'],
    ['👮','警察','Police Officer'],['🕵️','侦探','Detective'],['💂','卫兵','Guard'],['👷','建筑工人','Construction Worker'],
    ['🧑‍🌾','农民','Farmer'],['👨‍🍳','厨师','Cook'],['👩‍🔬','科学家','Scientist'],['🧑‍💻','程序员','Technologist'],
    ['👨‍🎤','歌手','Singer'],['👩‍🎨','艺术家','Artist'],['🧑‍✈️','飞行员','Pilot'],['👨‍🚀','宇航员','Astronaut'],
    ['👩‍⚕️','医生','Health Worker'],['🧑‍🏫','教师','Teacher'],['👨‍⚖️','法官','Judge'],['🤴','王子','Prince'],['👸','公主','Princess'],
    ['🤵','穿礼服的人','Person in Tuxedo'],['👰','披头纱的人','Person with Veil'],['🥷','忍者','Ninja'],['🧙','法师','Mage'],
    ['🧝','精灵','Elf'],['🧛','吸血鬼','Vampire'],['🧟','僵尸','Zombie'],['🧞','精灵','Genie'],
    ['🏃','跑步者','Person Running'],['🚶','行人','Person Walking'],['🧎','跪姿','Person Kneeling'],['🧍','站立者','Person Standing'],
    ['🙆','举手OK','Person Gesturing OK'],['🙅','拒绝手势','Person Gesturing No'],['💁','咨询台','Person Tipping Hand'],['🙋','举手','Person Raising Hand'],
    ['🤷','耸肩','Person Shrugging'],['🤦','捂脸','Person Facepalming'],['🤸','侧手翻','Person Cartwheeling'],['⛹️','打篮球','Person Bouncing Ball'],
    ['🏋️','举重','Person Lifting Weights'],['🤼','摔跤','Wrestlers'],['🏌️','打高尔夫','Person Golfing'],['🎿','滑雪','Skier'],
    ['🏂','单板滑雪','Snowboarder'],['🏊','游泳','Swimmer'],['🏄','冲浪','Person Surfing'],['🚣','划船','Person Rowing Boat'],
    ['🚴','骑自行车','Person Biking'],['🛹','滑板','Skateboarder'],['🪂','跳伞','Parachute'],['💃','跳舞女人','Woman Dancing'],
    ['🕺','跳舞男人','Man Dancing'],['🕴️','悬浮西装','Man in Suit Levitating'],
    ['👨‍👩‍👧','一家三口','Family: Man, Woman, Girl'],['👨‍👩‍👧‍👦','一家四口','Family: Man, Woman, Girl, Boy'],['👩‍👩‍👧','女同家庭','Family: Woman, Woman, Girl'],
    ['👨‍👨‍👦','男同家庭','Family: Man, Man, Boy'],['👫','男女牵手','Woman and Man Holding Hands'],['👭','女女牵手','Two Women Holding Hands'],
    ['👬','男男牵手','Two Men Holding Hands'],['💏','亲吻','Kiss'],['💑','情侣','Couple with Heart'],
    ['👀','双眼','Eyes'],['👁️','单眼','Eye'],['👃','鼻子','Nose'],['👄','嘴','Mouth'],['👅','舌头','Tongue'],['🦷','牙齿','Tooth'],
    ['🦴','骨头','Bone'],['👂','耳朵','Ear'],['🦻','助听器','Ear with Hearing Aid'],['🦶','脚','Foot'],['🦵','腿','Leg'],['🦿','机械腿','Mechanical Leg'],
    ['🫀','心脏','Anatomical Heart'],['🫁','肺','Lungs'],['🧠','大脑','Brain'],['🩸','血滴','Drop of Blood'],
  ],
  '动物与自然': [
    ['🐶','狗脸','Dog Face'],['🐕','狗','Dog'],['🐩','贵宾犬','Poodle'],['🐺','狼','Wolf'],['🦊','狐狸','Fox'],['🐱','猫脸','Cat Face'],
    ['🐈','猫','Cat'],['🦁','狮子','Lion'],['🐯','老虎脸','Tiger Face'],['🐅','老虎','Tiger'],['🐆','豹子','Leopard'],['🐴','马头','Horse Face'],
    ['🐎','马','Horse'],['🦄','独角兽','Unicorn'],['🦓','斑马','Zebra'],['🦌','鹿','Deer'],['🐮','牛脸','Cow Face'],['🐂','公牛','Ox'],
    ['🐃','水牛','Water Buffalo'],['🐷','猪脸','Pig Face'],['🐖','猪','Pig'],['🐗','野猪','Boar'],['🐑','绵羊','Ewe'],['🐐','山羊','Goat'],
    ['🐪','单峰驼','Camel'],['🐫','双峰驼','Two-Hump Camel'],['🦙','羊驼','Llama'],['🦒','长颈鹿','Giraffe'],['🐘','大象','Elephant'],
    ['🦣','猛犸象','Mammoth'],['🦏','犀牛','Rhinoceros'],['🦛','河马','Hippopotamus'],['🐭','老鼠脸','Mouse Face'],['🐁','老鼠','Mouse'],
    ['🐀','大鼠','Rat'],['🐹','仓鼠','Hamster'],['🐰','兔子脸','Rabbit Face'],['🐇','兔子','Rabbit'],['🦔','刺猬','Hedgehog'],['🦨','臭鼬','Skunk'],
    ['🦡','獾','Badger'],['🐨','考拉','Koala'],['🐼','熊猫','Panda'],['🦥','树懒','Sloth'],['🦦','水獭','Otter'],['🦝','浣熊','Raccoon'],
    ['🐻','熊','Bear'],['🐻‍❄️','北极熊','Polar Bear'],
    ['🐔','鸡','Chicken'],['🐓','公鸡','Rooster'],['🐣','破壳小鸡','Hatching Chick'],['🐤','小鸡','Baby Chick'],['🦆','鸭子','Duck'],
    ['🦢','天鹅','Swan'],['🦅','鹰','Eagle'],['🦉','猫头鹰','Owl'],['🦩','火烈鸟','Flamingo'],['🦚','孔雀','Peacock'],['🦜','鹦鹉','Parrot'],
    ['🐦','鸟','Bird'],['🐧','企鹅','Penguin'],['🕊️','鸽子','Dove'],
    ['🐸','青蛙','Frog'],['🐊','鳄鱼','Crocodile'],['🐢','乌龟','Turtle'],['🦎','蜥蜴','Lizard'],['🐍','蛇','Snake'],['🐉','龙','Dragon'],
    ['🐲','龙头','Dragon Face'],['🦕','长颈龙','Sauropod'],['🦖','霸王龙','T-Rex'],['🐳','喷水鲸','Spouting Whale'],['🐋','鲸鱼','Whale'],
    ['🐬','海豚','Dolphin'],['🦭','海豹','Seal'],['🐟','鱼','Fish'],['🐠','热带鱼','Tropical Fish'],['🐡','河豚','Blowfish'],['🦈','鲨鱼','Shark'],
    ['🐙','章鱼','Octopus'],['🦀','螃蟹','Crab'],['🦞','龙虾','Lobster'],['🦐','虾','Shrimp'],['🦑','鱿鱼','Squid'],['🐚','贝壳','Spiral Shell'],
    ['🪸','珊瑚','Coral'],['🐌','蜗牛','Snail'],['🦋','蝴蝶','Butterfly'],['🐛','毛毛虫','Caterpillar'],['🐜','蚂蚁','Ant'],['🐝','蜜蜂','Honeybee'],
    ['🐞','瓢虫','Lady Beetle'],['🕷️','蜘蛛','Spider'],['🕸️','蜘蛛网','Spider Web'],['🦂','蝎子','Scorpion'],['🦟','蚊子','Mosquito'],['🪰','苍蝇','Fly'],
    ['🪱','蠕虫','Worm'],['🦠','微生物','Microbe'],
    ['💐','花束','Bouquet'],['💮','白花','White Flower'],['🌸','樱花','Cherry Blossom'],['🌹','玫瑰','Rose'],['🥀','枯萎的花','Wilted Flower'],
    ['🌺','扶桑花','Hibiscus'],['🌻','向日葵','Sunflower'],['🌼','雏菊','Blossom'],['🌷','郁金香','Tulip'],['🌱','幼苗','Seedling'],['🌿','香草','Herb'],
    ['☘️','三叶草','Shamrock'],['🍀','四叶草','Four Leaf Clover'],['🍁','枫叶','Maple Leaf'],['🍂','落叶','Fallen Leaf'],['🍃','飘叶','Leaf Fluttering in Wind'],
    ['🌵','仙人掌','Cactus'],['🌴','棕榈树','Palm Tree'],['🌲','松树','Evergreen Tree'],['🌳','落叶树','Deciduous Tree'],['🌰','栗子','Chestnut'],
    ['🪨','岩石','Rock'],['🪵','木头','Wood'],
    ['☀️','太阳','Sun'],['🌤️','晴转多云','Sun Behind Small Cloud'],['⛅','多云转晴','Sun Behind Cloud'],['🌥️','多云','Sun Behind Large Cloud'],
    ['☁️','云','Cloud'],['🌦️','晴转雨','Sun Behind Rain Cloud'],['🌧️','下雨','Cloud with Rain'],['⛈️','雷暴','Cloud with Lightning and Rain'],
    ['🌩️','打雷','Cloud with Lightning'],['🌨️','下雪','Cloud with Snow'],['❄️','雪花','Snowflake'],['☃️','雪人','Snowman'],['⛄','无帽雪人','Snowman Without Snow'],
    ['🌬️','大风','Wind Face'],['💨','尾气','Dashing Away'],['🌪️','龙卷风','Tornado'],['🌫️','雾','Fog'],['🌈','彩虹','Rainbow'],['🌊','浪花','Water Wave'],
    ['💧','水滴','Droplet'],['💦','汗滴','Sweat Droplets'],['⚡','闪电','High Voltage'],['🔥','火焰','Fire'],['💫','眩晕','Dizzy'],['✨','闪烁','Sparkles'],
    ['⭐','星星','Star'],['🌟','闪亮星星','Glowing Star'],['🌙','弯月','Crescent Moon'],['🌝','笑满月','Full Moon Face'],['🌞','笑太阳','Sun with Face'],
    ['🌍','地球欧洲非洲','Globe Showing Europe-Africa'],['🌎','地球美洲','Globe Showing Americas'],['🌏','地球亚洲澳洲','Globe Showing Asia-Australia'],
    ['🌐','经纬地球','Globe with Meridians'],
  ],
  '食物与饮料': [
    ['🍎','红苹果','Red Apple'],['🍏','青苹果','Green Apple'],['🍐','梨','Pear'],['🍊','橘子','Tangerine'],['🍋','柠檬','Lemon'],['🍌','香蕉','Banana'],
    ['🍉','西瓜','Watermelon'],['🍇','葡萄','Grapes'],['🍓','草莓','Strawberry'],['🍑','桃子','Peach'],['🍒','樱桃','Cherries'],['🥭','芒果','Mango'],
    ['🍍','菠萝','Pineapple'],['🥥','椰子','Coconut'],['🥝','猕猴桃','Kiwi Fruit'],['🍅','番茄','Tomato'],['🫐','蓝莓','Blueberries'],
    ['🥬','绿叶菜','Leafy Green'],['🥦','西兰花','Broccoli'],['🥒','黄瓜','Cucumber'],['🥕','胡萝卜','Carrot'],['🌽','玉米','Ear of Corn'],
    ['🫑','甜椒','Bell Pepper'],['🌶️','辣椒','Hot Pepper'],['🧄','大蒜','Garlic'],['🧅','洋葱','Onion'],['🥔','土豆','Potato'],['🍠','红薯','Roasted Sweet Potato'],
    ['🥗','沙拉','Green Salad'],['🫘','豆子','Beans'],['🫛','豌豆','Pea Pod'],
    ['🍞','面包','Bread'],['🥐','可颂','Croissant'],['🥖','法棍','Baguette Bread'],['🥨','椒盐卷饼','Pretzel'],['🥯','贝果','Bagel'],['🧀','奶酪','Cheese Wedge'],
    ['🥚','鸡蛋','Egg'],['🍳','煎蛋','Cooking'],['🥓','培根','Bacon'],['🥩','牛排','Cut of Meat'],['🍗','鸡腿','Poultry Leg'],['🍖','排骨','Meat on Bone'],
    ['🌭','热狗','Hot Dog'],['🍔','汉堡','Hamburger'],['🍟','薯条','French Fries'],['🍕','披萨','Pizza'],['🥪','三明治','Sandwich'],['🥙','皮塔饼','Stuffed Flatbread'],
    ['🌮','墨西哥卷','Taco'],['🌯','墨西哥卷饼','Burrito'],['🍝','意面','Spaghetti'],['🍜','拉面','Steaming Bowl'],['🍲','炖菜','Pot of Food'],['🍛','咖喱饭','Curry Rice'],
    ['🍚','米饭','Cooked Rice'],['🍙','饭团','Rice Ball'],['🍘','米饼','Rice Cracker'],['🍡','团子','Dango'],['🥟','饺子','Dumpling'],['🥠','幸运饼干','Fortune Cookie'],['🥡','外卖盒','Takeout Box'],
    ['🍦','甜筒','Soft Ice Cream'],['🍧','刨冰','Shaved Ice'],['🍨','冰淇淋','Ice Cream'],['🍩','甜甜圈','Doughnut'],['🍪','曲奇','Cookie'],
    ['🎂','生日蛋糕','Birthday Cake'],['🍰','蛋糕片','Shortcake'],['🧁','纸杯蛋糕','Cupcake'],['🥧','派','Pie'],['🍫','巧克力','Chocolate Bar'],
    ['🍬','糖果','Candy'],['🍭','棒棒糖','Lollipop'],['🍮','布丁','Custard'],['🍯','蜂蜜','Honey Pot'],
    ['🥤','带吸管杯','Cup with Straw'],['🧋','珍珠奶茶','Bubble Tea'],['🍵','热茶','Teacup Without Handle'],['☕','咖啡','Hot Beverage'],['🫖','茶壶','Teapot'],
    ['🍺','啤酒','Beer Mug'],['🍻','碰杯','Clinking Beer Mugs'],['🥂','香槟碰杯','Clinking Glasses'],['🍷','红酒','Wine Glass'],['🍸','鸡尾酒','Cocktail Glass'],
    ['🍹','热带饮料','Tropical Drink'],['🥃','威士忌','Tumbler Glass'],['🧃','果汁盒','Beverage Box'],['🥛','牛奶','Glass of Milk'],
    ['🍽️','餐具','Fork and Knife with Plate'],['🍴','刀叉','Fork and Knife'],['🥄','勺子','Spoon'],['🥢','筷子','Chopsticks'],['🍶','清酒','Sake'],['🏺','陶罐','Amphora'],
  ],
  '旅行与地点': [
    ['🗺️','世界地图','World Map'],['🗾','日本地图','Map of Japan'],['🏔️','雪山','Snow-Capped Mountain'],['⛰️','山','Mountain'],['🗻','富士山','Mount Fuji'],
    ['🏕️','露营','Camping'],['🏖️','海滩','Beach with Umbrella'],['🏜️','沙漠','Desert'],['🏝️','小岛','Desert Island'],['🌋','火山','Volcano'],
    ['🏠','房子','House'],['🏡','带花园的房子','House with Garden'],['🏘️','住宅区','Houses'],['🏚️','废墟','Derelict House'],['🏗️','施工','Building Construction'],
    ['🏢','办公楼','Office Building'],['🏬','百货商店','Department Store'],['🏦','银行','Bank'],['🏥','医院','Hospital'],['🏫','学校','School'],['⛪','教堂','Church'],
    ['🕌','清真寺','Mosque'],['🛕','印度教寺庙','Hindu Temple'],['🕍','犹太教堂','Synagogue'],['⛩️','神社','Shinto Shrine'],['🏛️','古典建筑','Classical Building'],
    ['🏰','城堡','Castle'],['🗼','东京塔','Tokyo Tower'],['🗽','自由女神像','Statue of Liberty'],['💒','婚礼教堂','Wedding'],
    ['🚗','汽车','Car'],['🚕','出租车','Taxi'],['🚙','越野车','Sport Utility Vehicle'],['🚐','房车','Camper'],['🚚','卡车','Delivery Truck'],['🚛','半挂车','Articulated Lorry'],
    ['🚌','公交车','Bus'],['🚎','电车','Trolleybus'],['🚋','有轨电车','Tram'],['🚞','登山火车','Mountain Railway'],['🚂','蒸汽火车','Locomotive'],['🚄','高铁','High-Speed Train'],
    ['🚆','火车','Train'],['🚇','地铁','Metro'],['🚈','轻轨','Light Rail'],['🚲','自行车','Bicycle'],['🛵','踏板车','Motor Scooter'],['🏍️','摩托车','Motorcycle'],
    ['🦽','轮椅','Manual Wheelchair'],['🛴','滑板车','Kick Scooter'],['🚢','轮船','Ship'],['⛴️','渡轮','Ferry'],['🚤','快艇','Speedboat'],['🛶','独木舟','Canoe'],
    ['🚀','火箭','Rocket'],['✈️','飞机','Airplane'],['🛩️','小飞机','Small Airplane'],['🚁','直升机','Helicopter'],['🎈','气球','Balloon'],['🪁','风筝','Kite'],
    ['🕐','一点钟','One O’Clock'],['🕑','两点钟','Two O’Clock'],['🕒','三点钟','Three O’Clock'],['🕓','四点钟','Four O’Clock'],['🕔','五点钟','Five O’Clock'],
    ['🕕','六点钟','Six O’Clock'],['🕖','七点钟','Seven O’Clock'],['🕗','八点钟','Eight O’Clock'],['🕘','九点钟','Nine O’Clock'],['🕙','十点钟','Ten O’Clock'],
    ['🕚','十一点钟','Eleven O’Clock'],['🕛','十二点钟','Twelve O’Clock'],['🕜','一点半','One-Thirty'],['🕝','两点半','Two-Thirty'],['🕞','三点半','Three-Thirty'],
    ['🕟','四点半','Four-Thirty'],['🕠','五点半','Five-Thirty'],['🕡','六点半','Six-Thirty'],['🕢','七点半','Seven-Thirty'],['🕣','八点半','Eight-Thirty'],
    ['🕤','九点半','Nine-Thirty'],['🕥','十点半','Ten-Thirty'],['🕦','十一点半','Eleven-Thirty'],['🕧','十二点半','Twelve-Thirty'],
    ['⏰','闹钟','Alarm Clock'],['🕰️','座钟','Mantelpiece Clock'],['⏱️','秒表','Stopwatch'],['⏲️','计时器','Timer Clock'],['⌛','沙漏','Hourglass Done'],
    ['⏳','流动沙漏','Hourglass Not Done'],['📅','日历','Calendar'],['📆','日程本','Tear-Off Calendar'],['🗓️','线圈日历','Spiral Calendar'],
  ],
  '活动': [
    ['⚽','足球','Soccer Ball'],['🏀','篮球','Basketball'],['🏈','美式橄榄球','American Football'],['⚾','棒球','Baseball'],['🎾','网球','Tennis'],
    ['🏐','排球','Volleyball'],['🏉','橄榄球','Rugby Football'],['🥏','飞盘','Flying Disc'],['🎱','台球','Pool 8 Ball'],['🏓','乒乓球','Ping Pong'],
    ['🏸','羽毛球','Badminton'],['🏒','冰球','Ice Hockey'],['🏑','曲棍球','Field Hockey'],['🏏','板球','Cricket Game'],['🪃','回旋镖','Boomerang'],['🥅','球门','Goal Net'],
    ['⛳','高尔夫','Flag in Hole'],['🎣','钓鱼竿','Fishing Pole'],['🤿','潜水面罩','Diving Mask'],['🥊','拳击手套','Boxing Glove'],['🥋','柔道服','Martial Arts Uniform'],
    ['🎽','运动衫','Running Shirt'],['🎿','滑雪','Skis'],['🏂','滑雪板','Snowboard'],['🪂','跳伞','Parachute'],
    ['🎮','游戏手柄','Video Game'],['🕹️','摇杆','Joystick'],['🎰','老虎机','Slot Machine'],['🎲','骰子','Game Die'],['♟️','国际象棋兵','Chess Pawn'],
    ['🧩','拼图','Puzzle Piece'],['🪀','悠悠球','Yo-Yo'],['🪁','风筝','Kite'],
    ['🎵','音符','Musical Note'],['🎶','多音符','Multiple Musical Notes'],['🎼','乐谱','Musical Score'],['🎤','麦克风','Microphone'],['🎧','耳机','Headphone'],
    ['🎷','萨克斯','Saxophone'],['🎸','吉他','Guitar'],['🎹','钢琴','Musical Keyboard'],['🥁','鼓','Drum'],['🎺','小号','Trumpet'],['🎻','小提琴','Violin'],
    ['🪗','手风琴','Accordion'],['🎨','调色盘','Artist Palette'],['🖼️','画框','Framed Picture'],['🎭','戏剧面具','Performing Arts'],['🎬','场记板','Clapper Board'],
    ['🎉','庆祝','Party Popper'],['🎊','彩带','Confetti Ball'],['🎁','礼物','Gift'],['🎀','蝴蝶结','Ribbon'],['🎈','气球','Balloon'],['🎂','生日蛋糕','Birthday Cake'],
    ['🏆','奖杯','Trophy'],['🥇','金牌','1st Place Medal'],['🥈','银牌','2nd Place Medal'],['🥉','铜牌','3rd Place Medal'],['🏅','奖牌','Sports Medal'],
    ['🎖️','军功章','Military Medal'],['🏵️','花饰','Rosette'],['🎗️','丝带','Reminder Ribbon'],
  ],
  '物品': [
    ['👕','T恤','T-Shirt'],['👖','牛仔裤','Jeans'],['👔','领带','Necktie'],['👗','连衣裙','Dress'],['👘','和服','Kimono'],['🥻','纱丽','Sari'],
    ['🧥','外套','Coat'],['🧣','围巾','Scarf'],['🧤','手套','Gloves'],['🧦','袜子','Socks'],['👟','运动鞋','Running Shoe'],['👠','高跟鞋','High-Heeled Shoe'],
    ['👡','凉鞋','Woman’s Sandal'],['🥿','拖鞋','Flat Shoe'],['👢','靴子','Woman’s Boot'],['🎩','礼帽','Top Hat'],['🧢','棒球帽','Billed Cap'],
    ['👒','女帽','Woman’s Hat'],['🎓','学士帽','Graduation Cap'],['👑','皇冠','Crown'],['💍','戒指','Ring'],['💎','钻石','Gem Stone'],['📿','念珠','Prayer Beads'],
    ['👜','手提包','Handbag'],['👝','零钱包','Clutch Bag'],['🎒','背包','Backpack'],['👓','眼镜','Glasses'],['🕶️','墨镜','Sunglasses'],['🥽','护目镜','Goggles'],
    ['📱','手机','Mobile Phone'],['📲','来电','Mobile Phone with Arrow'],['☎️','座机','Telephone'],['📞','电话听筒','Telephone Receiver'],['📟','寻呼机','Pager'],
    ['💻','笔记本电脑','Laptop'],['🖥️','台式电脑','Desktop Computer'],['🖨️','打印机','Printer'],['⌨️','键盘','Keyboard'],['🖱️','鼠标','Computer Mouse'],['🖲️','轨迹球','Trackball'],
    ['💽','光盘','Computer Disk'],['💾','软盘','Floppy Disk'],['💿','CD','Optical Disk'],['📀','DVD','DVD'],['📼','录像带','Videocassette'],
    ['📷','相机','Camera'],['📸','拍照','Camera with Flash'],['📹','摄像机','Video Camera'],['🎥','电影摄影机','Movie Camera'],['📺','电视','Television'],['📻','收音机','Radio'],
    ['🎙️','录音麦','Studio Microphone'],['🔊','喇叭','Speaker High Volume'],['🔉','中音量','Speaker Medium Volume'],['🔈','低音量','Speaker Low Volume'],['🔇','静音','Muted Speaker'],
    ['🔋','电池','Battery'],['🔌','插头','Electric Plug'],['💡','灯泡','Light Bulb'],['🔦','手电筒','Flashlight'],['🪔','油灯','Diya Lamp'],['🕯️','蜡烛','Candle'],
    ['📄','文件','Page Facing Up'],['📃','带纹文件','Page with Curl'],['📑','标签页','Tabs'],['📊','柱状图','Bar Chart'],['📈','上升趋势图','Chart Increasing'],['📉','下降趋势图','Chart Decreasing'],
    ['📋','剪贴板','Clipboard'],['📌','图钉','Pushpin'],['📎','回形针','Paperclip'],['🖇️','装订夹','Linked Paperclips'],['✂️','剪刀','Scissors'],['🗃️','卡片盒','Card File Box'],
    ['🗄️','文件柜','File Cabinet'],['🗑️','垃圾桶','Wastebasket'],['✏️','铅笔','Pencil'],['✒️','钢笔','Fountain Pen'],['🖊️','圆珠笔','Pen'],['🖋️','蘸水笔','Fountain Pen (alt)'],
    ['🖌️','画笔','Paintbrush'],['🖍️','蜡笔','Crayon'],['📝','备忘录','Memo'],['📓','笔记本','Notebook'],['📔','带装饰笔记本','Notebook with Decorative Cover'],['📒','账本','Ledger'],
    ['📕','红皮书','Closed Book'],['📖','打开的书','Open Book'],['📗','绿皮书','Green Book'],['📘','蓝皮书','Blue Book'],['📙','橙皮书','Orange Book'],['📚','书堆','Books'],['🔖','书签','Bookmark'],
    ['💰','钱袋','Money Bag'],['💴','日元','Yen Banknote'],['💵','美元','Dollar Banknote'],['💶','欧元','Euro Banknote'],['💷','英镑','Pound Banknote'],['💸','长翅膀的钱','Money with Wings'],
    ['💳','信用卡','Credit Card'],['🧾','收据','Receipt'],['💹','货币升值','Currency Exchange'],
    ['✉️','信封','Envelope'],['📧','电子邮件','E-Mail'],['📨','来信','Incoming Envelope'],['📩','收信','Envelope with Arrow'],['📤','发件箱','Outbox Tray'],['📥','收件箱','Inbox Tray'],
    ['📦','包裹','Package'],['📫','关闭邮箱','Closed Mailbox with Raised Flag'],['📬','打开邮箱','Open Mailbox with Raised Flag'],
    ['🔧','扳手','Wrench'],['🔨','锤子','Hammer'],['⚒️','铁锤','Hammer and Pick'],['🛠️','工具套装','Hammer and Wrench'],['⛏️','镐','Pick'],['🔩','螺母螺栓','Nut and Bolt'],
    ['🪓','斧头','Axe'],['🧰','工具箱','Toolbox'],['🪑','椅子','Chair'],['🚪','门','Door'],['🛋️','沙发','Couch and Lamp'],['🛏️','床','Bed'],['🧺','篮子','Basket'],
    ['🧻','卷纸','Roll of Paper'],['🧼','肥皂','Soap'],['🧽','海绵','Sponge'],['🪣','水桶','Bucket'],['🧹','扫帚','Broom'],
    ['💊','药丸','Pill'],['💉','针管','Syringe'],['🩹','创可贴','Adhesive Bandage'],['🩺','听诊器','Stethoscope'],['⚕️','医学符号','Medical Symbol'],['🧬','DNA','DNA'],
    ['🔬','显微镜','Microscope'],['⚗️','蒸馏器','Alembic'],['🧪','试管','Test Tube'],['🧫','培养皿','Petri Dish'],
  ],
  '符号': [
    ['🚦','红绿灯','Vertical Traffic Light'],['🚥','横向红绿灯','Horizontal Traffic Light'],['🛑','停止标志','Stop Sign'],['🚧','施工标志','Construction'],
    ['⚠️','警告','Warning'],['🚸','儿童过街','Children Crossing'],['🛗','电梯','Elevator'],
    ['➡️','右箭头','Right Arrow'],['⬅️','左箭头','Left Arrow'],['⬆️','上箭头','Up Arrow'],['⬇️','下箭头','Down Arrow'],['↗️','右上箭头','Up-Right Arrow'],
    ['↘️','右下箭头','Down-Right Arrow'],['↙️','左下箭头','Down-Left Arrow'],['↖️','左上箭头','Up-Left Arrow'],['↕️','上下箭头','Up-Down Arrow'],['↔️','左右箭头','Left-Right Arrow'],
    ['🔄','顺时针箭头','Clockwise Vertical Arrows'],['🔃','逆时针箭头','Clockwise Arrows Button'],['🔙','返回','Back Arrow'],['🔚','结束','End Arrow'],['🔛','开启','On! Arrow'],
    ['🔜','即将到来','Soon Arrow'],['🔝','顶部','Top Arrow'],
    ['✝️','十字架','Latin Cross'],['☦️','东正教十字','Orthodox Cross'],['☪️','星月','Star and Crescent'],['🕉️','欧姆','Om'],['✡️','大卫之星','Star of David'],['☸️','法轮','Wheel of Dharma'],
    ['♈','白羊座','Aries'],['♉','金牛座','Taurus'],['♊','双子座','Gemini'],['♋','巨蟹座','Cancer'],['♌','狮子座','Leo'],['♍','处女座','Virgo'],['♎','天秤座','Libra'],
    ['♏','天蝎座','Scorpio'],['♐','射手座','Sagittarius'],['♑','摩羯座','Capricorn'],['♒','水瓶座','Aquarius'],['♓','双鱼座','Pisces'],
    ['🔴','红圆','Red Circle'],['🟠','橙圆','Orange Circle'],['🟡','黄圆','Yellow Circle'],['🟢','绿圆','Green Circle'],['🔵','蓝圆','Blue Circle'],['🟣','紫圆','Purple Circle'],
    ['⚫','黑圆','Black Circle'],['⚪','白圆','White Circle'],['🟤','棕圆','Brown Circle'],['🔺','红三角上','Red Triangle Pointed Up'],['🔻','红三角下','Red Triangle Pointed Down'],
    ['🔸','橙菱形','Small Orange Diamond'],['🔹','蓝菱形','Small Blue Diamond'],['🔶','大橙菱形','Large Orange Diamond'],['🔷','大蓝菱形','Large Blue Diamond'],
    ['◾','黑方块','Black Medium-Small Square'],['◽','白方块','White Medium-Small Square'],['⬛','大黑方块','Black Large Square'],['⬜','大白方块','White Large Square'],
    ['▪️','黑小方块','Black Small Square'],['▫️','白小方块','White Small Square'],['♾️','无限','Infinity'],['✖️','乘号','Multiply'],['➕','加号','Plus'],['➖','减号','Minus'],['➗','除号','Divide'],['〰️','波浪线','Wavy Dash'],
    ['❗','感叹号','Exclamation Mark'],['❓','问号','Question Mark'],['❕','白感叹号','White Exclamation Mark'],['❔','白问号','White Question Mark'],['💯','一百分','Hundred Points'],
    ['✅','勾选','Check Mark Button'],['❌','叉号','Cross Mark'],['⭕','空心圆','Hollow Red Circle'],['✳️','星号','Eight-Spoked Asterisk'],['✴️','八角星','Eight-Pointed Star'],['❇️','闪烁','Sparkle'],
    ['✨','星光','Sparkles'],['💢','愤怒符号','Anger Symbol'],['💬','对话气泡','Speech Balloon'],['💭','思考气泡','Thought Balloon'],['🗨️','左对话泡','Left Speech Bubble'],['🗯️','愤怒对话泡','Right Anger Bubble'],
    ['💤','呼噜','Zzz'],['💈','理发店转灯','Barber Pole'],['🎏','鲤鱼旗','Carp Streamer'],['🎐','风铃','Wind Chime'],['🧿','邪眼','Nazar Amulet'],['♻️','回收','Recycling Symbol'],
    ['🔱','三叉戟','Trident Emblem'],['⚜️','鸢尾花','Fleur-de-Lis'],['📛','名牌','Name Badge'],['🔞','成人限制','No One Under Eighteen'],
    ['0️⃣','数字0','Keycap Digit Zero'],['1️⃣','数字1','Keycap Digit One'? 'Keycap Digit One':'Keycap Digit One'],['2️⃣','数字2','Keycap Digit Two'],['3️⃣','数字3','Keycap Digit Three'],['4️⃣','数字4','Keycap Digit Four'],
    ['5️⃣','数字5','Keycap Digit Five'],['6️⃣','数字6','Keycap Digit Six'],['7️⃣','数字7','Keycap Digit Seven'],['8️⃣','数字8','Keycap Digit Eight'],['9️⃣','数字9','Keycap Digit Nine'],['🔟','数字10','Keycap 10'],
    ['#️⃣','井号键','Keycap Number Sign'],['*️⃣','星号键','Keycap Asterisk'],['ℹ️','信息','Information'],['🆗','OK','OK Button'],['🆕','新','NEW Button'],['🆙','升级','UP! Button'],['🆒','酷','COOL Button'],
    ['🆓','免费','FREE Button'],['🆖','无','NG Button'],['🎦','影院','Cinema'],['📶','信号','Antenna Bars'],
  ],
  '旗帜': [
    ['🇨🇳','中国国旗','Flag: China'],['🇺🇸','美国国旗','Flag: United States'],['🇯🇵','日本国旗','Flag: Japan'],['🇰🇷','韩国国旗','Flag: South Korea'],['🇬🇧','英国国旗','Flag: United Kingdom'],
    ['🇫🇷','法国国旗','Flag: France'],['🇩🇪','德国国旗','Flag: Germany'],['🇮🇹','意大利国旗','Flag: Italy'],['🇪🇸','西班牙国旗','Flag: Spain'],['🇷🇺','俄罗斯国旗','Flag: Russia'],
    ['🇧🇷','巴西国旗','Flag: Brazil'],['🇮🇳','印度国旗','Flag: India'],['🇨🇦','加拿大国旗','Flag: Canada'],['🇦🇺','澳大利亚国旗','Flag: Australia'],
    ['🏳️','白旗','White Flag'],['🏴','黑旗','Black Flag'],['🏁','方格旗','Chequered Flag'],['🚩','三角旗','Triangular Flag'],['🏳️‍🌈','彩虹旗','Rainbow Flag'],['🏴‍☠️','海盗旗','Pirate Flag'],['🎌','交叉旗','Crossed Flags'],
  ],
  '组件': [
    ['🏻','浅肤色','Light Skin Tone'],['🏼','中浅肤色','Medium-Light Skin Tone'],['🏽','中等肤色','Medium Skin Tone'],['🏾','中深肤色','Medium-Dark Skin Tone'],['🏿','深肤色','Dark Skin Tone'],
    ['🦰','红发','Red Hair'],['🦱','卷发','Curly Hair'],['🦲','白发','White Hair'],['🦳','秃顶','Bald'],
  ],
};

const norm = (e) => String(e || '').replace(/️/g, ''); // 去变体选择符(U+FE0F)
// 旧默认库(常用/目录与文件/应用与工具/媒体与音乐/游戏与生活)中那些未被 10 大分类覆盖的孤立 emoji,
// 折叠进对应新分类,使新库成为"旧库 + 官方 10 分类"的超集,旧分组可安全删除而不丢图标。
CATS['物品'].push(
  ['📁','文件夹','File Folder'],['📂','打开文件夹','Open File Folder'],['🗂','卡片索引','Card Index Dividers'],
  ['📍','定位图钉','Round Pushpin'],['🗒','便签本','Spiral Notepad'],['📇','名片索引','Card Index'],
  ['📪','关闭邮箱','Closed Mailbox with Lowered Flag'],['📭','空邮箱','Open Mailbox with Lowered Flag'],['📮','邮筒','Postbox'],['🏷','标签','Label'],
  ['⚙','齿轮','Gear'],['🪛','螺丝刀','Screwdriver'],['🪚','手锯','Saw'],['🧲','磁铁','Magnet'],['⚓','锚','Anchor'],['🛡','盾牌','Shield'],
  ['🔍','放大镜左','Magnifying Glass Tilted Left'],['🔎','放大镜右','Magnifying Glass Tilted Right'],['🎛','控制台','Control Knobs'],['🎚','音量滑块','Level Slider'],
  ['📡','天线','Satellite Antenna'],['🔭','望远镜','Telescope'],['🧱','砖块','Brick'],['🧊','冰块','Ice'],['🧭','指南针','Compass'],
);
CATS['旅行与地点'].push(['⛵','帆船','Sailboat'],['🛰','卫星','Satellite'],['🛸','飞碟','Flying Saucer']);
CATS['活动'].push(
  ['🎞','胶片','Film Frames'],['📽','放映机','Film Projector'],['🪕','班卓琴','Banjo'],['🎪','马戏团','Circus Tent'],['🎫','门票','Admission Tickets'],['🎟','票根','Admission Tickets'],
  ['🎯','靶心','Direct Hit'],['🎳','保龄球','Bowling'],['⛸','溜冰鞋','Ice Skate'],['🧧','红包','Red Envelope'],['🛍','购物袋','Shopping Bags'],['🛒','购物车','Shopping Cart'],
  ['🪄','魔法棒','Magic Wand'],['🎆','烟花','Fireworks'],['🎇','烟花棒','Sparkler'],['🧸','泰迪熊','Teddy Bear'],['🎄','圣诞树','Christmas Tree'],['🎋','竹子','Tanabata Tree'],['🏮','灯笼','Red Paper Lantern'],
);

const seen = new Map(); // normalized -> [emoji, cn, en]
const dups = [];
const lib = [];
for (const [group, entries] of Object.entries(CATS)) {
  const items = [];
  for (const [emoji, cn, en] of entries) {
    const k = norm(emoji);
    if (seen.has(k)) {
      dups.push(`${emoji} (${cn}) 重复,首次出现于「${seen.get(k)[1]}」`);
      continue;
    }
    seen.set(k, [emoji, cn, en]);
    items.push(emoji);
  }
  lib.push({ group, items });
}

// 生成 DEFAULT_ICON_LIBRARY
const libLines = lib.map((g) => {
  const arr = '[' + g.items.map((e) => JSON.stringify(e)).join(', ') + ']';
  return `  { group: ${JSON.stringify(g.group)}, items: ${arr} },`;
}).join('\n');
const libBlock = `export const DEFAULT_ICON_LIBRARY = [\n${libLines}\n];`;

// 生成 EMOJI_NAMES
// 注意:key 必须以「去 U+FE0F 变体选择符」后的归一化字符生成,与所有按名称查找的路径
// (seed / 迁移 / emojiPage 搜索与卡片名 / pickEmojiModal 提示 / 合并函数 iconEmojiKey)对齐;
// 否则带选择符的 emoji 查不到名称,导致按名称搜索失效。
const nameLines = [];
for (const [, entries] of Object.entries(CATS)) {
  for (const [emoji, cn, en] of entries) {
    const k = norm(emoji);
    if (!nameLines._taken) nameLines._taken = new Set();
    if (nameLines._taken.has(k)) continue;
    nameLines._taken.add(k);
    nameLines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(cn + ' / ' + en)},`);
  }
}
delete nameLines._taken;
const nameBlock = `export const EMOJI_NAMES = {\n${nameLines.join('\n')}\n};`;

// 写回 state.js
const reLib = /export const DEFAULT_ICON_LIBRARY = \[[\s\S]*?\n\];/;
const reNames = /export const EMOJI_NAMES = \{[\s\S]*?\n\};/;
if (!reLib.test(src)) throw new Error('未找到 DEFAULT_ICON_LIBRARY 块');
if (!reNames.test(src)) throw new Error('未找到 EMOJI_NAMES 块');
src = src.replace(reLib, libBlock);
src = src.replace(reNames, nameBlock);
fs.writeFileSync(STATE, src, 'utf8');

console.log('分类数:', lib.length);
console.log('去重后 emoji 总数:', seen.size);
console.log('发现的重复:', dups.length);
dups.forEach((d) => console.log('  - ' + d));
console.log('已写回', STATE);
