/* ============================================================
   回声公寓 · 叙事引擎
   —— 关键词意图识别 + 状态机 + 守则解锁 + 时间推进
   接口：EchoEngine.newState() / respond(state, input) / choices(state)
   ============================================================ */

const EchoEngine = (() => {

  'use strict';

  /* ── 常量 ───────────────────────────────────────────── */

  const TOTAL_MINUTES = 360;      // 00:00 → 06:00
  const MIN_GAIN = 6;             // 每次行动最少消耗
  const MAX_GAIN = 13;

  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

  /* ── 状态工厂 ───────────────────────────────────────── */

  function newState() {
    return {
      minutes: 0,
      clarity: 100,
      records: 4,
      act: 'act1',
      flags: {
        met302: false, met501: false, met902: false, met101: false,
        counted13: false, countedTwice: false,
        elevator13: false, mirrorDone: false, radioDone: false,
        stairsLamp: false, saltDone: false, bathRice: false,
        key307: false, parcel404: false, wroteRecord: false,
        heardEchoEarly: false, sawName: false, signed: false
      },
      rules: ['r01', 'r02', 'r03', 'r04', 'r05', 'r06', 'r07'],
      talked: {},
      items: Object.fromEntries(ITEMS.map(i => [i.id, i.qty])),
      log: [],
      turns: 0,
      ending: null
    };
  }

  /* ── 工具 ───────────────────────────────────────────── */

  function clockText(minutes) {
    const total = 0 * 60 + minutes;          // 从 00:00 起
    const h = Math.floor(total / 60) % 24;
    const m = total % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  function shiftName(minutes) {
    if (minutes < 60) return '初更';
    if (minutes < 130) return '二更';
    if (minutes < 200) return '三更';
    if (minutes < 270) return '四更';
    if (minutes < 330) return '五更';
    return '近黎明';
  }

  function actOf(minutes) {
    for (let i = ACTS.length - 1; i >= 0; i--) {
      if (minutes >= ACTS[i].at) return ACTS[i];
    }
    return ACTS[0];
  }

  function pick(list, seed) {
    const i = Math.abs(Math.floor(seed)) % list.length;
    return list[i];
  }

  const has = (s, ...words) => words.some(w => s.includes(w));

  /* ── 结果构造器 ─────────────────────────────────────── */

  function result() {
    return { blocks: [], choices: [], effects: {}, notes: [] };
  }

  function narr(r, ...paras) {
    r.blocks.push({ type: 'narr', paras: paras.filter(Boolean) });
    return r;
  }

  function whisper(r, text) {
    r.blocks.push({ type: 'narr', paras: [text], whisper: true });
    return r;
  }

  function sys(r, text, mood) {
    r.blocks.push({ type: 'sys', text, mood: mood || 'warn' });
    return r;
  }

  function ruleBlock(r, ruleId) {
    const rule = RULES.find(x => x.id === ruleId);
    if (!rule) return r;
    r.blocks.push({ type: 'rule', ruleId: rule.id, no: rule.no, text: rule.text, src: rule.src });
    r.effects.rules = r.effects.rules || [];
    if (!r.effects.rules.includes(ruleId)) r.effects.rules.push(ruleId);
    return r;
  }

  function choice(r, label, icon) {
    r.choices.push({ label, icon: icon || 'i-chevron' });
    return r;
  }

  /* ── 意图表 ─────────────────────────────────────────── */

  const INTENTS = [

    /* ══ 开局与总览 ══ */
    {
      key: 'help',
      match: /^(帮助|怎么玩|玩法|指令|你能做什么|引导)/,
      run(s, r) {
        narr(r,
          '你把椅子转正，双手放在膝盖上，像上台前那样。这栋楼的规矩不复杂，只是没写在明面上：',
          '**问得具体，答得具体。** 说“电梯”“登记簿”“三楼”，楼就会把那一块翻给你看；只说“看看”，它只会给你看走廊。',
          '**每说一句话，夜色就少一点。** 六个小时，大概够你说三十句话。说到六点还没弄明白，你就得写交接单了——写给下一个人。',
          '**守则是真的，但每条只说了一半。** 另一半在住户嘴里。你得去问，还得问到点子上。');
        choice(r, '先翻看守则', 'i-scroll');
        choice(r, '先打开登记簿', 'i-book');
        return r;
      }
    },

    {
      key: 'rules-read',
      match: /(守则|规则|规定|墙上的)/,
      run(s, r) {
        const known = s.rules.length;
        narr(r,
          '墙上七条，蓝底白字，从一到七。你从头往下读，读到第七条的时候，楼道里所有能响的东西同时安静了一瞬——冰箱、日光灯、水管的滴漏——然后一起重新响起来。',
          '第七条只有六个字：**天亮前，不要数到十三。**',
          '字比上面六条都大一号。下面的空白很干净，干净得像被人反复擦过。');
        sys(r, `守则簿已收录 ${known} 条。红笔补写的内容在「守则簿」里能翻到。`, 'ok');
        choice(r, '把第七条抄在记录簿上', 'i-scroll');
        choice(r, '去电梯那边看看', 'i-door');
        return r;
      }
    },

    /* ══ 电梯 ══ */
    {
      key: 'elevator',
      match: /(电梯|轿厢|按钮|上楼|下楼|十三颗)/,
      run(s, r) {
        if (!s.flags.elevator13) {
          s.flags.elevator13 = true;
          r.effects.flag = 'elevator13';
          narr(r,
            '电梯停在一楼，门开着，像在等你。你走进去，门在你身后合上，没有声音。',
            '按钮面板是黄铜的，从 1 到 12 排成两列。你数了一遍——确实是十二颗。你正要按一楼的开门键，指尖碰到了一颗你刚才没看见的按钮。',
            '它没有编号。它比别的按钮低一点，摸上去是凉的，像刚从水里捞出来。',
            '轿厢的镜子在你右手边。你从镜子里看见自己，还看见自己身后那面墙——那面墙上也有一面镜子，镜子里也有一个你。三层，然后就没了。');
          ruleBlock(r, 'r12');
          sys(r, '收听到住户口述守则：第十二条。', 'ok');
          choice(r, '闭眼，按下那颗没编号的按钮', 'i-fingerprint');
          choice(r, '睁着眼按下去', 'i-eye');
          choice(r, '退出电梯，走楼梯', 'i-stairs');
          return r;
        }

        if (s.flags.elevator13 && !s.flags.heardEchoEarly) {
          narr(r,
            '你又站在轿厢里。那颗没编号的按钮在等，像一句没说完的话。',
            '面板下面有一道很浅的刻痕，是有人用钥匙尖刻的：**“先想清楚，你要往下还是往上。”**');
          choice(r, '闭眼按', 'i-fingerprint');
          choice(r, '睁眼按', 'i-eye');
          choice(r, '先不按，退出去', 'i-door');
          return r;
        }

        narr(r,
          '电梯门开着，轿厢空着。你没有进去。',
          '站在外面看，那颗没编号的按钮在面板最下面，安静得像一颗备用的纽扣。',
          '你忽然想：这栋楼一共十二层，每层四户，四十八户。可登记簿只有十二行。');
        choice(r, '闭眼按那颗按钮', 'i-fingerprint');
        choice(r, '去找陆知白问清楚', 'i-key');
        return r;
      }
    },

    {
      key: 'elevator-eyes-closed',
      match: /(闭眼|闭上眼|合眼)/,
      run(s, r) {
        s.flags.key307 = s.flags.key307 || true;
        narr(r,
          '你闭上眼，世界变成一层温热的红。你摸到那颗按钮，按下去。',
          '没有下坠感。电梯没有动。',
          '但你听见了“叮”的一声——到站的提示音。你睁开眼，楼层显示是一楼，门开着，外面是值守室门口那盏灯。',
          '你低头，手里多了一把黄铜钥匙。上面刻着 **307**。',
          '这栋楼没有三〇七。你把钥匙攥紧了，铜的凉气一直钻到手心里。');
        sys(r, '获得物品：黄铜钥匙 · 307。守则第十二条后半句已被你验证。', 'ok');
        r.effects.items = { it01: 1 };
        ruleBlock(r, 'r12');
        return r;
      }
    },

    {
      key: 'elevator-eyes-open',
      match: /(睁眼|睁着眼|不闭眼)/,
      run(s, r) {
        narr(r,
          '你没闭眼。你按下那颗没编号的按钮。',
          '电梯开始上升。数字一格一格跳动：2、4、6、8——全是偶数。守则第二条说，电梯只在单数层停靠。',
          '到 12 的时候它没有停。数字变成了 13。',
          '门开了。外面是一条走廊，和你脚下这条一模一样，地毯、壁灯、尽头的窗，连窗台上那道裂纹都一样。走廊尽头站着一个人，背对着你，穿值守员的深蓝色马甲。',
          '他没有回头。他在等电梯。',
          '门自己合上了。你回到一楼的时候，膝盖有点软。');
        sys(r, '清醒度 -12。你在十三楼停留了十一秒。', 'bad');
        r.effects.clarity = -12;
        ruleBlock(r, 'r07');
        choice(r, '回值守室坐下，缓一缓', 'i-clock');
        choice(r, '把这件事写进记录簿', 'i-scroll');
        return r;
      }
    },

    /* ══ 楼梯 / 灯 ══ */
    {
      key: 'stairs',
      match: /(楼梯|楼梯间|楼道|爬楼)/,
      run(s, r) {
        if (!s.flags.stairsLamp) {
          s.flags.stairsLamp = true;
          r.effects.flag = 'stairsLamp';
          narr(r,
            '楼梯间的灯是那种老式螺口灯泡，罩着一个铁网罩。你推开门的时候它亮着，很亮，把水泥台阶照得发白。',
            '你往上走了半层，灯灭了。',
            '你站住，等了四秒——守则第四条说三秒内离开。第四秒的时候，灯又亮了。',
            '亮起来的时候，你看见台阶上有一个很淡的鞋印，湿的，从四楼往下延伸到一半，就断了。你脚下这一级，是干的。');
          ruleBlock(r, 'r13');
          sys(r, '收听到住户口述守则：第十三条。清醒度 -5。', 'warn');
          r.effects.clarity = -5;
          choice(r, '退出去，从门缝里再看一眼', 'i-eye');
          choice(r, '继续往上走', 'i-stairs');
          return r;
        }
        narr(r,
          '楼梯间的灯一直亮着。你数过：从一楼到十二楼，一百三十二级。',
          '你今晚第三次数，数到一百三十一的时候灯灭了一下，再亮起来时你已经站在十二楼平台上，不记得最后一级是怎么迈上来的。',
          '平台尽头有一扇门，门上没有门牌，只有四个螺丝孔——原来的牌子被拧走了。');
        choice(r, '用黄铜钥匙试试这扇门', 'i-key');
        choice(r, '退回楼下', 'i-stairs');
        return r;
      }
    },

    /* ══ 清点人数 ══ */
    {
      key: 'count',
      match: /(清点|数人|点人数|查人数|登记簿|名册|住户列表)/,
      run(s, r) {
        if (!s.flags.counted13) {
          s.flags.countedTwice = true;
          narr(r,
            '你翻开登记簿。深蓝布面，硬壳，纸边发黄。十二行名字，一列房号，字迹是人一个一个填的，钢笔水的深浅都不一样。',
            '你从第一行开始念，念到第十二行：秦望，一二〇三。',
            '念完之后，房间里安静了两秒。然后你听见有人在纸背那边，很轻很轻地，跟着念了一遍第十二个名字。',
            '你把本子翻到最后一页——是空的。但你合上它的时候，明显感到比刚才厚了一点。');
          sys(r, '清点结果：12 人。记录完整度 +6。', 'ok');
          r.effects.records = 6;
          choice(r, '再数一遍', 'i-fingerprint');
          choice(r, '合上本子，不数了', 'i-book');
          return r;
        }

        narr(r,
          '登记簿摊在桌上。你知道再数一遍会发生什么，你也知道那件事已经发生过一次了。',
          '本子还是那本本子，十二行名字，第十二行后面是一片干净的空白。',
          '空白里有一点铅笔压痕，需要把纸对着灯才看得见。');
        choice(r, '把纸对着灯看', 'i-eye');
        choice(r, '合上本子', 'i-book');
        return r;
      }
    },

    {
      key: 'count-again',
      match: /(再数一遍|再清点|数第二遍|再数一次)/,
      run(s, r) {
        s.flags.counted13 = true;
        r.effects.flag = 'counted13';
        r.effects.clarity = -14;
        narr(r,
          '你又数了一遍。这次你数得很慢，一个一个念出声。',
          '一、二、三……十一、十二。',
          '你停在十二，喉咙有点干。你抬头，正准备合上本子——',
          '“十三。”',
          '不是你说的。声音在你左边，和你一模一样，只是慢了 1.1 秒。',
          '你猛地转头。左手边只有那台老式收音机，刻度盘停在 88.7，指示灯没有亮。');
        sys(r, '清醒度 -14。你数到了十三。守则第七条已被打破。', 'bad');
        ruleBlock(r, 'r08');
        ruleBlock(r, 'r07');
        choice(r, '在记录簿上写下“十二”', 'i-scroll');
        choice(r, '什么都不写，先坐下', 'i-clock');
        return r;
      }
    },

    /* ══ 镜子 ══ */
    {
      key: 'mirror',
      match: /(镜子|镜中|照镜|洗手台|水银)/,
      run(s, r) {
        if (!s.flags.mirrorDone) {
          s.flags.mirrorDone = true;
          r.effects.flag = 'mirrorDone';
          r.effects.clarity = -8;
          narr(r,
            '值守室的洗手台在角落，上方挂着一面老镜子，水银层里有一圈一圈的波纹，像年轮。',
            '你抬头。镜子里是你，比你想的累一点。你身后是值班台、台灯、墙上的七条守则。',
            '然后你身后那面墙上，第八条守则出现了。',
            '红笔，直接从墙里透出来，一个字一个字变清楚：**“第七条已经过期。”**',
            '你在镜子里看它，看得一清二楚。你转过身去看真实的那面墙——墙上还是七条，第八条的位置只有一片空白。');
          sys(r, '清醒度 -8。你在镜子里读到了第八条。建议不要回头。', 'warn');
          ruleBlock(r, 'r08');
          choice(r, '不回头，直接走到台前坐下', 'i-clock');
          choice(r, '再看一眼镜子里的那行字', 'i-eye');
          return r;
        }
        narr(r,
          '镜子里还是你。你已经不太确定“还是”这两个字用得对不对了。',
          '镜面上那道划痕今天更长了一点，从左下角一直划到右上角，正好把镜中的你分成两半。');
        choice(r, '伸手擦一下镜面', 'i-eye');
        choice(r, '走开', 'i-door');
        return r;
      }
    },

    /* ══ 敲门 ══ */
    {
      key: 'knock',
      match: /(敲门|有人敲门|开门|门外的|门响)/,
      run(s, r) {
        narr(r,
          '门被敲了三下。不重，很稳，每一下之间隔着正好一秒——像有人掐着秒表。',
          '“值班的，我是五〇一的陆知白。”门外说，声音隔着门板闷了一层，“电梯今晚不太对，你去看看。”',
          '你翻登记簿。五〇一，陆知白，在册。第八行。',
          '可是陆知白今晚值的是外面那班电梯维保——他一个半小时前才在楼道里跟你说过话，那时候他刚从外面回来，身上有雨。',
          '而现在，外面没有雨。');
        sys(r, '核对结果：姓名在册，但时间对不上。守则第三条只说“核对登记簿”，没说核对完该怎么办。', 'warn');
        choice(r, '隔着门问：你今晚几点下的班', 'i-bell');
        choice(r, '不开门，也不说话', 'i-lock');
        choice(r, '开门', 'i-door');
        return r;
      }
    },

    {
      key: 'knock-ask',
      match: /(隔着门问|问他是谁|问他几点|隔着门)/,
      run(s, r) {
        narr(r,
          '“你今晚几点下的班？”你隔着门问。',
          '门外安静了很久。久到你以为人已经走了。',
          '“我没有上班。”门外说，声音比刚才近了一点，“我今晚一直在家。你要是想确认，就上来看看我在不在。”',
          '你低头看门缝。门缝底下没有影子。走廊那盏灯的亮度足够照亮任何一个人的脚。',
          '门外又安静了。然后你听见脚步声，往楼梯间的方向去了，一步、两步、三步——走到第四步就没有声音了，但那第四步不该这么轻。');
        sys(r, '门外那位已离开。清醒度 -6。', 'warn');
        r.effects.clarity = -6;
        choice(r, '开门看一眼走廊', 'i-door');
        choice(r, '上楼去五〇一确认', 'i-stairs');
        return r;
      }
    },

    {
      key: 'open-door',
      match: /(开门|把门打开|拉开门)/,
      run(s, r) {
        r.effects.clarity = -20;
        narr(r,
          '你开了门。',
          '走廊是空的。灯亮着，地毯平整，什么都没有。',
          '你正要关上门，注意到一件事：走廊尽头那面镜子里，站着一个穿深蓝马甲的人，背对着你，站在值守室门口的位置。',
          '镜子里那个人，站在你身后。',
          '你低头看自己脚边的地板——地板上没有第二个人的影子。');
        sys(r, '清醒度 -20。守则第五条：不要回头，直接走到值班台前坐下。', 'bad');
        choice(r, '不回头，走到台前坐下', 'i-clock');
        choice(r, '回头', 'i-eye');
        return r;
      }
    },

    /* ══ 收音机 ══ */
    {
      key: 'radio',
      match: /(收音机|电台|频率|88\.7|广播)/,
      run(s, r) {
        if (!s.flags.radioDone) {
          s.flags.radioDone = true;
          r.effects.flag = 'radioDone';
          narr(r,
            '收音机自己响了。旋钮没动，指示灯没亮，可它就是响了——先是一段很长的电流声，像雨落在铁皮棚上。',
            '然后有人说话。是个女的，声音压得很低，念的不是新闻，是名字。',
            '“三〇二，沈砚秋。五〇一，陆知白。一〇一，周慧兰……”',
            '她一个一个念下来。念到第十二个的时候，停了一下。',
            '“第十三个，”她说，“请值班的自己念。”');
          ruleBlock(r, 'r11');
          sys(r, '收音机自行启动。守则第十一条：让它响完。', 'warn');
          choice(r, '坐着听完', 'i-bell');
          choice(r, '关掉它', 'i-close');
          return r;
        }
        narr(r,
          '收音机安静了。你把手放在外壳上，还是凉的，没有一点余温——它不像响过。',
          '刻度盘停在 88.7。你试着转了一下旋钮，指针纹丝不动，像被什么粘住了。');
        choice(r, '再试一次旋钮', 'i-radio');
        choice(r, '算了', 'i-door');
        return r;
      }
    },

    {
      key: 'radio-listen',
      match: /(听完|让它响|坐着听|不关)/,
      run(s, r) {
        narr(r,
          '你坐着，听完了。',
          '她念完十二个名字之后，说了最后一句话：“交接时间是六点整。如果六点没人来，就说明——”',
          '电流声盖住了后半句。等了大概七秒，声音回来了：“——你就是接班的人。”',
          '收音机安静下来。你发现自己的手一直在抖，抖得很规律，一秒一下。');
        sys(r, '记录完整度 +8。你记下了收音机里的清单。', 'ok');
        r.effects.records = 8;
        ruleBlock(r, 'r11');
        return r;
      }
    },

    /* ══ 盐 ══ */
    {
      key: 'salt',
      match: /(盐|撒盐|盐线|粗盐)/,
      run(s, r) {
        if (!s.flags.saltDone) {
          s.flags.saltDone = true;
          r.effects.flag = 'saltDone';
          r.effects.items = { it03: -1 };
          narr(r,
            '你拆开那袋粗盐，从门内侧开始撒。颗粒落在水泥地上，声音很细，像下雨。',
            '撒到一半的时候，你发现盐线经过门缝的位置会自己断开——不是被风吹的，是像被什么东西从外侧抹掉了一小段。',
            '你补上。它又断。补到第三次，盐线终于连成了完整的一圈。',
            '就在连上的那一瞬间，走廊里的灯暗了一格。不是熄灭，是变暗，像有人把电压拧低了一档。');
          ruleBlock(r, 'r09');
          sys(r, '粗盐 -1。盐线已闭合。清醒度 +4（安心感）。', 'ok');
          r.effects.clarity = 4;
          choice(r, '在窗台上也撒一道', 'i-drop');
          choice(r, '回台前坐下', 'i-clock');
          return r;
        }
        narr(r,
          '盐线还在，一圈完整。你蹲下来看，颗粒边缘有一层很薄的潮气。',
          '这栋楼不潮。你住进来第一天就发现，墙纸是干的，连天井那面都是干的。');
        choice(r, '再补一道在窗台', 'i-drop');
        choice(r, '站起来', 'i-door');
        return r;
      }
    },

    /* ══ 记录簿 / 书写 ══ */
    {
      key: 'write',
      match: /(写|记录|记下|抄|动笔|写上)/,
      run(s, r) {
        if (!s.flags.wroteRecord) {
          s.flags.wroteRecord = true;
          r.effects.flag = 'wroteRecord';
          narr(r,
            '你翻开记录簿封二。红笔那行字印在那里：**“记录簿不是用来记录发生了什么，是用来记录你希望发生什么。”**',
            '下面还有一行更小的字，被划掉过两次才写清：**“用它记录，它就会成真。别乱写。”**',
            '你握着笔，笔尖悬在纸上。纸很白，白得不像一本用了三十九年的本子。');
          ruleBlock(r, 'r09');
          sys(r, '你可以写下任何一句话。写下去的，会更容易发生。', 'warn');
          choice(r, '写：“今晚十二个人，一个不少。”', 'i-scroll');
          choice(r, '写：“天亮时我会走出这栋楼。”', 'i-scroll');
          choice(r, '先不写，把笔放下', 'i-book');
          return r;
        }
        narr(r,
          '笔还在你手里。纸面上一片空白，等着你写下今晚的第二句话。',
          '你注意到一件事：你刚才写的那行字，墨迹已经彻底干了，干得像写了很久。');
        choice(r, '再写一句', 'i-scroll');
        choice(r, '合上本子', 'i-book');
        return r;
      }
    },

    {
      key: 'write-twelve',
      match: /(十二个人|一个不少|都平安|都在)/,
      run(s, r) {
        narr(r,
          '你写下：“今晚十二个人，一个不少。”',
          '最后一个句号落下去的时候，楼里有一声很轻的响动，从很高的地方传来，像有人把一口箱子放在了地板上。',
          '然后你听见楼梯间有人在往上走，一步、两步、三步。走到一半，停了。',
          '登记簿上，第十二行“秦望”的墨迹，比刚才深了一点。');
        sys(r, '记录已生效。清醒度 +6，记录完整度 +10。', 'ok');
        r.effects.clarity = 6;
        r.effects.records = 10;
        r.effects.flags = { signed: true };
        return r;
      }
    },

    {
      key: 'write-dawn',
      match: /(走出这栋楼|天亮.*走出|活到天亮|六点)/,
      run(s, r) {
        narr(r,
          '你写下：“天亮时我会走出这栋楼。”',
          '笔尖离开纸面的一瞬间，你听见门厅那边传来一声很轻的“咔嗒”——门锁弹开的声音。',
          '可门本来就是开着的。守则第一条：值守期间不得锁门。',
          '那这一声是从哪来的？你抬头看门，门开着，外面是黑的，黑得很安静。');
        sys(r, '记录已生效。清醒度 -4（你不太确定自己写了什么）。', 'warn');
        r.effects.clarity = -4;
        r.effects.records = 6;
        return r;
      }
    },

    /* ══ 住户对话 ══ */
    {
      key: 'r302',
      match: /(302|三〇二|沈老师|沈砚秋|语文|讲台|课文)/,
      run(s, r) {
        s.talked['p01'] = true;
        if (!s.flags.met302) {
          s.flags.met302 = true;
          r.effects.flag = 'met302';
          narr(r,
            '你上三楼。三〇二的门虚掩着，里面亮着一盏台灯，光从门缝里斜出来，在地上画了一道很长很窄的梯形。',
            '屋里摆着四十二张空椅子，面朝一块小黑板。黑板上写着四个字：**请讲普通话。**',
            '沈砚秋坐在讲台后面，正在批作业。她没有抬头：“现在几点？”',
            '“零点四十。”你说。',
            '“那我不该说话。”她把红笔放下，“你来得早了点。两点以后再来，我把该说的说完。”');
          ruleBlock(r, 'r10');
          sys(r, '已与住户交谈：沈砚秋。她给了一个时间条件。', 'ok');
          r.effects.records = 5;
          choice(r, '那就等到两点再来', 'i-clock');
          choice(r, '问她讲台底下压着什么', 'i-book');
          choice(r, '问她四十二张椅子是谁的', 'i-users');
          return r;
        }

        if (s.minutes < 120) {
          narr(r,
            '你敲三〇二的门。里面的朗读声停了。',
            '隔了很久，门缝里推出一张纸条，楷书，一笔一画：**“说了两点。现在不是两点。”**',
            '你把纸条折好。纸条背面还有一行，更小：**“别催。我在这栋楼里等了三十九年，不差你这一晚。”**');
          sys(r, '时间条件未满足。清醒度 -2。', 'warn');
          r.effects.clarity = -2;
          return r;
        }

        narr(r,
          '两点零七分。三〇二的门自己开了。',
          '沈砚秋站在讲台后面，手里拿着半截粉笔。她终于抬头看你：“坐。第一排，第二个位置。”',
          '你坐下。椅子比看上去矮，坐下去得抬头看她，像真的在上课。',
          '“这栋楼每隔几年会多一层。”她说，“不是往上多，是往中间多。你数楼层数不出来，因为它是横着长进来的。”',
          '“三〇七那间房，就是横着长进来的。钥匙在陆知白手里。他给你，你就拿着；他不给，你别抢。”');
        ruleBlock(r, 'r10');
        sys(r, '沈砚秋给了你关于楼层结构的关键信息。记录完整度 +8。', 'ok');
        r.effects.records = 8;
        choice(r, '问她讲台底下压着什么', 'i-book');
        choice(r, '问她自己那一晚数到了几', 'i-fingerprint');
        return r;
      }
    },

    {
      key: 'r302-desk',
      match: /(讲台底下|讲台下|作文纸|底下压着)/,
      run(s, r) {
        narr(r,
          '讲台底下压着一个牛皮纸信封，边角磨得起毛。',
          '里面是一叠作文纸，同一个题目：《我的家》。一共十二篇，字迹各不相同，落款全是这栋楼的住户。',
          '最后一篇没有署名，只有一行字：“我家有十三个人，可是妈妈说只能写十二个。”',
          '沈砚秋在你身后说：“那篇是一九九六年交上来的。那年我教四年级。”');
        sys(r, '记录完整度 +10。你手上多了一份不该存在的证词。', 'ok');
        r.effects.records = 10;
        r.effects.items = { it13: 1 };
        choice(r, '把这篇带走', 'i-scroll');
        choice(r, '放回去，问沈老师为什么留着', 'i-bell');
        return r;
      }
    },

    {
      key: 'r501',
      match: /(501|五〇一|陆知白|电梯工|钥匙|307|三〇七)/,
      run(s, r) {
        s.talked['p02'] = true;
        s.flags.met501 = true;
        r.effects.flag = 'met501';
        narr(r,
          '五〇一的门开着一条缝，里面亮着工作灯。陆知白坐在小马扎上拆一台电机，零件按大小排开，一颗螺丝都不乱。',
          '“电梯的事你别自己试。”他头也不抬，“十三那个键，一个班只按一次。按第二次，它记得你。”',
          '他的工具包敞着，里面那把黄铜钥匙在灯下很亮。钥匙上刻着 307。',
          '“三〇七不是房号。”他终于抬头，“是层号。这栋楼横着长出来的那一层，编号是三〇七。”');
        ruleBlock(r, 'r12');
        sys(r, '陆知白确认了 307 的含义。记录完整度 +7。', 'ok');
        r.effects.records = 7;
        choice(r, '问他要那把钥匙', 'i-key');
        choice(r, '问他为什么不自己上去看', 'i-eye');
        return r;
      }
    },

    {
      key: 'ask-key',
      match: /(要.*钥匙|借.*钥匙|给我钥匙|把那把)/,
      run(s, r) {
        narr(r,
          '“钥匙给我。”你说。',
          '陆知白看了你很久。他把钥匙拿起来，在手里转了半圈，又放下。',
          '“你确定？”他说，“拿了钥匙，三〇七就算你的了。你的意思是——从今晚起，那间房里的事，归你管。”',
          '“归我管。”你说。',
          '他把钥匙推过来。“那就拿去。记住：进去之前，先在门口站满一分钟。这一分钟不是给我面子，是给自己留个退路。”');
        sys(r, '获得：黄铜钥匙 · 307。清醒度 -4。', 'ok');
        r.effects.items = { it01: 1 };
        r.effects.clarity = -4;
        return r;
      }
    },

    {
      key: 'r902',
      match: /(902|九〇二|温子恒|调音|回声|音叉)/,
      run(s, r) {
        s.talked['p06'] = true;
        s.flags.met902 = true;
        narr(r,
          '九〇二的门上贴着一张手写纸：“调音中，请勿按铃。”',
          '你敲门。开门的是个瘦高的中年人，手里握着音叉，音叉还在振。他把食指竖在嘴唇前，等音叉彻底安静下来才开口：',
          '“你听见的回声，是几秒？”',
          '“大概一秒。”',
          '“一点一秒。”他纠正你，很认真，“这栋楼比别人慢十分之一秒。所以它藏东西藏得好——你以为你听见的是回声，其实是上一句话。”',
          '他把手贴在墙上：“你听。”',
          '你把手也贴上去。墙面很凉，凉得不像室内。里面有一种极低的嗡鸣，像很远的地方有人一直在说话，说了一整晚，没有停。');
        ruleBlock(r, 'r14');
        sys(r, '收听到住户口述守则：第十四条。记录完整度 +7。', 'ok');
        r.effects.records = 7;
        choice(r, '问他墙上那十七个软木塞', 'i-tape');
        choice(r, '问他听过最奇怪的一次回声', 'i-eye');
        return r;
      }
    },

    {
      key: 'r902-cork',
      match: /(软木塞|十七个|音准|走音)/,
      run(s, r) {
        narr(r,
          '墙上十七个软木塞，每一个下面压着一张纸条，写着一个音名和一个日期。',
          '“十二层，十二个音。”温子恒说，“多出来的五个，是我在路上捡的。”',
          '“什么路上？”',
          '他指指地板：“往下。楼梯间到底，还有一级。踩下去会响，音高不对。那一级不属于这栋楼。”',
          '你问他那一级通向哪。他笑了一下，笑得有点难看：“通向一个不需要音准的地方。”');
        sys(r, '记录完整度 +8。你有了一个具体的、可以走下去的方向。', 'ok');
        r.effects.records = 8;
        r.effects.flags = { stairsLamp: true };
        return r;
      }
    },

    {
      key: 'r101',
      match: /(101|一〇一|周慧兰|白饭|老太太|门房)/,
      run(s, r) {
        s.talked['p03'] = true;
        narr(r,
          '一〇一就在值守室隔壁。门关着，门口的鞋柜上放着一碗白饭，上面扣着一个盘子。',
          '你敲了两下。门里传来一个很慢的声音：“谁？”',
          '“新来的值守。”',
          '门开了一条两指宽的缝。周慧兰的眼睛在缝里，很亮，一点都不像七十八岁。',
          '“登记簿上写十二个人，”她说，“你就照十二个人记。多出来的那个，不要写进去，也不要问是谁。”',
          '“为什么？”',
          '“因为写进去的东西会留下。”她说，“你写他，他就在。你不写，他还得再等几年。”');
        sys(r, '记录完整度 +6。一〇一的饭，是给不在册的人留的。', 'ok');
        r.effects.records = 6;
        choice(r, '问那碗白饭是给谁的', 'i-drop');
        choice(r, '问她丈夫周德海那晚发生了什么', 'i-clock');
        return r;
      }
    },

    {
      key: 'r101-rice',
      match: /(白饭|碗|给谁|鞋柜)/,
      run(s, r) {
        narr(r,
          '“那碗饭，是给谁的？”',
          '门缝里的眼睛眨了一下。“给我丈夫。”',
          '“他什么时候回来？”',
          '“他下班就回来。”她说得很自然，像在说一件明天一定会发生的事，“他值夜，六点下班。你别把门锁上，他回来要进。”',
          '你想起守则第一条：值守期间不得锁门。',
          '你忽然明白这条守则不是给活人写的。');
        sys(r, '清醒度 -6。你理解了一条守则的另一半。', 'warn');
        r.effects.clarity = -6;
        r.effects.records = 8;
        ruleBlock(r, 'r01');
        return r;
      }
    },

    {
      key: 'r7',
      match: /(阿七|纸箱|废品|小女孩|捡废品)/,
      run(s, r) {
        s.talked['p04'] = true;
        narr(r,
          '阿七蹲在二楼转角，把纸箱一个一个压平，压得很整齐，摞成方方正正的一垛。',
          '“你数过窗户吗？”她抬头问。',
          '“没有。”',
          '“一百四十四扇。”她伸出手指给你看，指甲缝里全是灰，“晚上有一扇不亮，白天它亮。我盯了四个月。”',
          '“哪一扇？”',
          '她指了指上面：“十二楼，从东边数第七扇。可是十二楼只有六扇窗。”');
        ruleBlock(r, 'r13');
        sys(r, '记录完整度 +7。阿七给了你一个可验证的坐标。', 'ok');
        r.effects.records = 7;
        choice(r, '问她住在哪一层', 'i-door');
        choice(r, '给她一张写着字的纸', 'i-scroll');
        return r;
      }
    },

    {
      key: 'r7-home',
      match: /(住在哪|住几层|睡在哪|你住)/,
      run(s, r) {
        narr(r,
          '“你住哪一层？”',
          '阿七把最后一个纸箱压平，想了想：“楼梯间。”',
          '“哪一层？”',
          '“就是楼梯间。”她说，“楼梯间不算楼层，所以我不占名额。”',
          '她把纸箱垛抱起来，往上走。走了几步回头：“你要是想找我，就上楼，一直上，上到觉得累了就停——我在那儿。”');
        sys(r, '清醒度 -3。你不太确定“上到累了就停”是哪一层。', 'warn');
        r.effects.clarity = -3;
        return r;
      }
    },

    {
      key: 'r13th',
      match: /(十三|13|第十三个|多出来)/,
      run(s, r) {
        narr(r,
          '你把“十三”这件事在脑子里翻过来翻过去。',
          '守则第七条说不要数到十三。第八条说第七条过期了，可以数，但要把自己数进去。',
          '这两条不矛盾——如果你承认“你也是这栋楼里的一个人”。',
          '你数的时候把自己数进去了，那十二加一就是十三。可如果你不数自己，那第十二个人是谁？',
          '登记簿上第十二行是秦望。秦望不记得自己姓什么。他的名字是三〇二沈老师起的。');
        sys(r, '记录完整度 +5。你摸到了守则打架的地方。', 'warn');
        r.effects.records = 5;
        ruleBlock(r, 'r08');
        choice(r, '去十二楼看看秦望', 'i-eye');
        choice(r, '去翻登记簿最后一页', 'i-book');
        return r;
      }
    },

    {
      key: 'r12f',
      match: /(1203|一二〇三|秦望|第十二个|没有名字)/,
      run(s, r) {
        s.talked['p12'] = true;
        s.flags.sawName = true;
        r.effects.flag = 'sawName';
        narr(r,
          '十二楼走廊尽头站着一个人。深灰外套，两手插在口袋里，背对着你，看窗外。',
          '十二楼的窗户从东边数只有六扇。他站在第七扇前面。',
          '你只瞄了一眼，就低下头，默数自己的心跳。数到第十下的时候，你听见他开口了，声音很轻，像怕吵到谁：',
          '“我不记得我叫什么。”',
          '“他们叫我秦望。这个名字是沈老师起的。她说我总在望。”',
          '“你别看我太久。”他说，“我看人的时候，会以为那个人在等我。”');
        sys(r, '清醒度 -8。记录完整度 +9。', 'warn');
        r.effects.clarity = -8;
        r.effects.records = 9;
        choice(r, '问他还记不记得自己住哪', 'i-door');
        choice(r, '低头，退回去', 'i-stairs');
        return r;
      }
    },

    {
      key: 'r11o2',
      match: /(1102|一一〇二|一二〇二|何守业|楼长|签字)/,
      run(s, r) {
        s.talked['p08'] = true;
        narr(r,
          '一一〇二的门开着。何守业在玄关摆了一张折叠桌，桌上放着一本很厚的文件夹，封面写着“业主签字确认表（第二版）”。',
          '“你是新来的值守。”他站起来，很正式地跟你握手，“我是一二〇二的何守业，本楼楼长。”',
          '“门牌上写一一〇二。”',
          '“被人换过。”他说得毫不犹豫，“这栋楼本来是十二层，后来多出来一层。多的那层没人管，我就替大家管。”',
          '他翻开文件夹，里面密密麻麻全是签名，同一个人的字迹，签了四十七次。');
        sys(r, '清醒度 -4。记录完整度 +6。', 'warn');
        r.effects.clarity = -4;
        r.effects.records = 6;
        choice(r, '问他多出来的那层在哪', 'i-stairs');
        choice(r, '在确认表上签字', 'i-scroll');
        return r;
      }
    },

    {
      key: 'sign',
      match: /(签字|签名|签上|签了)/,
      run(s, r) {
        r.effects.flags = { signed: true };
        narr(r,
          '你在确认表上签了名。',
          '笔尖离开纸面的时候，何守业很郑重地把文件夹合上，双手压了一下：“签了就是认了。认了，就归你管。”',
          '“归我管什么？”',
          '“归你管这栋楼的夜班。”他说，“从今晚起，你签字之后发生的事，都算在你头上。”',
          '他把文件夹抱回怀里，像抱着一件很贵重的东西。你忽然很想把刚才那一笔划掉，但纸已经翻过去了。');
        sys(r, '清醒度 -8。你在某份文件上留下了名字。', 'bad');
        r.effects.clarity = -8;
        return r;
      }
    },

    {
      key: 'r10o',
      match: /(401|四〇一|邱明远|监控|摄像头|一帧)/,
      run(s, r) {
        s.talked['p10'] = true;
        narr(r,
          '四〇一的房间里摆了六台显示器，画面切成十七格，每一格标着编号。邱明远穿着睡衣，眼睛通红。',
          '“你看这一格。”他指天井，“每秒三十帧，我抽了三万帧比对。有三处永远差一帧：天井、四楼转角、值守室门口。”',
          '“差一帧说明什么？”',
          '“说明在我们看见的那一帧之前，画面上还有一帧。”他声音低下去，“机器不会漏帧。漏帧说明有人在那一帧里，做了不想被看见的事。”');
        sys(r, '记录完整度 +8。清醒度 -5。', 'warn');
        r.effects.clarity = -5;
        r.effects.records = 8;
        choice(r, '要那张天井的截图', 'i-photo');
        choice(r, '问他值守室门口那帧差在哪', 'i-eye');
        return r;
      }
    },

    {
      key: 'r608',
      match: /(608|六〇八|顾云岫|纸条|档案|分类)/,
      run(s, r) {
        s.talked['p09'] = true;
        narr(r,
          '六〇八门口没有门铃。你敲了三下，门缝底下推出一张纸条，字很淡，像隔着一层水写的：',
          '**“你已经问了六个住户。你在做分类。”**',
          '你确实正在做分类。你把每个人的话按主题排开，想找规律。',
          '第二张纸条紧跟着推出来：**“别急着分类。分类是驯服，驯服是假装懂了。这栋楼不怕你懂，怕你停下来。”**');
        ruleBlock(r, 'r09');
        sys(r, '清醒度 +3。记录完整度 +7。', 'ok');
        r.effects.clarity = 3;
        r.effects.records = 7;
        choice(r, '写一张纸条推回去', 'i-scroll');
        choice(r, '蹲下来看门缝', 'i-eye');
        return r;
      }
    },

    {
      key: 'r803',
      match: /(803|八〇三|邵蓉|药店|账本|盐缸)/,
      run(s, r) {
        s.talked['p11'] = true;
        narr(r,
          '邵蓉在门口蹲着撒盐，撒得极其均匀，用一根筷子量间距。',
          '“一圈要闭合。”她说，“留一个缺口，就等于留了一扇门。你要是来不及撒满，就干脆别撒——撒一半比不撒更糟。”',
          '她给你看她的账本。每一页都记着“今日支出/今日丢失”，丢失那一栏写着：一根火柴、半包盐、十分钟。',
          '“东西不会消失，”她说，“只会变成别人账本上的一行。”');
        ruleBlock(r, 'r09');
        sys(r, '获得：粗盐 ×1。记录完整度 +6。', 'ok');
        r.effects.items = { it03: 1 };
        r.effects.records = 6;
        return r;
      }
    },

    {
      key: 'r203',
      match: /(203|二〇三|白蕊|花店|绿萝|花)/,
      run(s, r) {
        s.talked['p07'] = true;
        narr(r,
          '二〇三门口十一盆绿萝，排成一列，每一盆底下压着一张纸条。',
          '白蕊正在给最后一盆浇水。她抬头笑：“你也数了？十一盆，十一个日期。”',
          '“这些日期是什么？”',
          '“有人搬走的日子。”她说得很轻，“这栋楼每年会少一个人。不是死，是搬走。搬走的人不记得自己住过这儿，可这些花记得。”',
          '她从桶里抽出一枝白花递给你：“插水里能活七天。七天之内你要是还没搞明白，就烧了它。别留着。”');
        sys(r, '记录完整度 +7。你手上多了一枝白花。', 'ok');
        r.effects.records = 7;
        choice(r, '问她第十二盆在哪', 'i-drop');
        choice(r, '把花插进搪瓷杯', 'i-drop');
        return r;
      }
    },

    {
      key: 'parcel404',
      match: /(404|四〇四|快递|包裹|纸盒)/,
      run(s, r) {
        s.flags.parcel404 = true;
        narr(r,
          '储藏柜最下层有一个巴掌大的纸盒，收件地址写着四〇四。胶带已经泛黄，上面落了很厚一层灰。',
          '这栋楼每层四户：一〇一、一〇二、一〇三、一〇四……四楼也一样。四〇四应该住人。',
          '可你翻遍登记簿，四楼只登记了三户。四〇四那一行，房号栏里是空的。',
          '你摇了摇盒子，里面很轻，像只有一张纸。');
        sys(r, '记录完整度 +5。你找到了一个不属于任何人的包裹。', 'warn');
        r.effects.records = 5;
        choice(r, '拆开它', 'i-box');
        choice(r, '送上四楼', 'i-stairs');
        choice(r, '放回去', 'i-box');
        return r;
      }
    },

    {
      key: 'open-parcel',
      match: /(拆开|撕开|打开盒子|拆包裹)/,
      run(s, r) {
        narr(r,
          '你撕开胶带。盒子发出一声很长的响，像有人在很远的地方叹气。',
          '里面是一张照片。',
          '照片上是这栋楼的门厅，拍摄角度在值守室这边。时间是夜里，灯亮着。照片正中站着一个穿深蓝马甲的人，背对着镜头。',
          '照片背面用铅笔写着一行字：**“第三十九任。他也没等到接班的人。”**',
          '你把照片翻过来，正面的那个人——他站的位置，就是你现在站的位置。');
        sys(r, '清醒度 -10。记录完整度 +8。', 'bad');
        r.effects.clarity = -10;
        r.effects.records = 8;
        return r;
      }
    },

    /* ══ 窗外 / 天井 ══ */
    {
      key: 'window',
      match: /(窗外|外面|看外面|天井|楼外|街)/,
      run(s, r) {
        narr(r,
          '值守室有一扇朝内开的窗，对着天井。',
          '天井很窄，四面都是墙，抬头能看见一小块天。今晚没有月亮，那块天黑得很均匀。',
          '你对着天井说了句“喂”。回声在一秒多一点以后回来：“喂。”',
          '你又说：“有人吗。”回声隔了一点一秒：“有人吗。”',
          '然后你再没说话。',
          '第三秒的时候，回声又响了一次：“有人吗。”');
        sys(r, '清醒度 -7。回声多响了一次。', 'bad');
        r.effects.clarity = -7;
        ruleBlock(r, 'r14');
        choice(r, '对着天井说“我在值班”', 'i-bell');
        choice(r, '关窗', 'i-close');
        return r;
      }
    },

    {
      key: 'shout',
      match: /(我在值班|我在这里|喊|大叫|回应)/,
      run(s, r) {
        narr(r,
          '“我在值班。”你说。',
          '回声隔了一点一秒回来：“我在值班。”',
          '这一次它没有再多响。天井安静了很长时间，长到你以为它结束了。',
          '然后从很高的地方，十三楼的窗户一扇一扇亮起来。不是同时，是从东边开始，一扇接一扇，像有人在沿着走廊走，边走边开灯。',
          '亮到第七扇的时候停了。',
          '那扇窗的位置，正好是阿七说的、白天才亮的那一扇。');
        sys(r, '清醒度 -9。记录完整度 +10。你被这栋楼确认了。', 'bad');
        r.effects.clarity = -9;
        r.effects.records = 10;
        r.effects.flags = { heardEchoEarly: true };
        return r;
      }
    },

    /* ══ 休息 / 天亮 ══ */
    {
      key: 'rest',
      match: /(坐下|休息|缓一缓|歇|喘口气|闭目)/,
      run(s, r) {
        narr(r,
          '你把椅子拉到值班台后面，坐下。',
          '椅子发出一声很长的响。你把手放在膝盖上，掌心朝下，像小时候被要求坐正那样。',
          '背对着走廊坐着，看不见门，也看不见镜子。你只能听见：日光灯的电流声、水管里偶尔一声闷响、还有远处电梯钢缆的摩擦声。',
          '心跳慢下来。你想，只要坐到天亮就没问题。',
          '这个念头刚成形，你就听见身后有人很轻地笑了一下——短促，克制的，像在为你这个念头鼓掌。');
        sys(r, '清醒度 +10。你坐了一会儿，身后没有东西。', 'ok');
        r.effects.clarity = 10;
        return r;
      }
    },

    {
      key: 'dawn',
      match: /(天亮|几点|时间|还要多久|交班|六点)/,
      run(s, r) {
        const left = TOTAL_MINUTES - s.minutes;
        narr(r,
          `墙上那口挂钟走到 ${clockText(s.minutes)}。距离六点整还有 ${Math.max(0, Math.floor(left / 60))} 小时 ${Math.max(0, left % 60)} 分。`,
          '钟是机械的，秒针走得很稳。你盯着看了一会儿，发现它每走一分钟会顿一下，像在犹豫要不要继续。',
          '交接单压在钟下面，空白。等天亮，你就得在上面写字。',
          '写什么？你还没想好。但你已经知道，写下去的东西会留下。');
        return r;
      }
    },

    {
      key: 'storage',
      match: /(储藏|柜子|铁皮柜|物品|东西在哪)/,
      run(s, r) {
        narr(r,
          '储藏柜在值班台左手边，铁皮，三格，锁早就坏了。',
          '第一格是工具：手电、粉笔、胶带、折叠镜。第二格是杂物：搪瓷杯、收音机、火柴、一袋粗盐。第三格最下层压着一个纸盒，收件地址写着四〇四。',
          '柜门内侧贴着一张打印的清单，用铅笔在上面勾过很多次，勾痕重叠在一起，纸都快磨破了。');
        sys(r, '完整清单在「物品储藏」里。', 'ok');
        choice(r, '打开第三格最下面', 'i-box');
        choice(r, '拿上手电', 'i-lamp');
        return r;
      }
    },

    {
      key: 'hint',
      match: /(提示|不知道做什么|下一步|该做什么|没头绪)/,
      run(s, r) {
        const tips = [
          '守则第三条说，敲门的人要先核对登记簿。可登记簿只核对了“是谁”，没有核对“什么时候”。',
          '三〇二沈老师说两点以后再来。她的钟比你的钟准。',
          '陆知白的钥匙上刻着 307。这栋楼没有三〇七房，但沈老师说有一层是横着长进来的。',
          s.flags.counted13
            ? '你已经数到了十三。现在的问题不是“会不会多一个人”，而是“多的是谁”。'
            : '墙上有七条守则，登记簿有十二行。这两个数字加起来是十九，减去你，是十八。',
          '阿七说十二楼从东边数第七扇窗。十二楼只有六扇。',
          '记录簿能写字。写下去的东西会更容易发生。'
        ];
        const t = pick(tips, s.turns + s.minutes);
        narr(r,
          '你把笔在手指间转了半圈，停下来。',
          `你想起一件事：${t}`,
          '外面走廊的灯很配合地闪了一下，像在点头。');
        return r;
      }
    }
  ];

  /* ── 兜底回应（有氛围、有推进，不像机器人） ─────────── */

  const FALLBACKS = [
    {
      paras: [
        '你说了这句话。楼里没有立刻回应——它一向如此，回声要等一点一秒。',
        '一点一秒之后，楼梯间的灯亮了一下，又灭了。',
        '你把这理解为“听见了”。'
      ]
    },
    {
      paras: [
        '你把注意力放到这件事上。',
        '走廊尽头那盏壁灯的光圈里，浮着一层很细的灰。灰在动，动得很慢，像有人刚刚从这里走过，空气还没落定。',
        '你记下时间。这是今晚第 ${turns} 次你想记下什么。'
      ]
    },
    {
      paras: [
        '你低声把这句话说了一遍，说完自己愣了一下。',
        '声音落在房间里，没有回音。值守室是这栋楼里唯一听不见回声的地方——你今晚才注意到。',
        '一点声音都没有的房间，其实比有回声的房间更让人不安。'
      ]
    },
    {
      paras: [
        '你在原地站了一会儿。',
        '墙上贴着一张泛黄的告示，边角翘起来：“本楼公共区域禁止张贴私人告示”。告示上又贴了一张纸条，写着“那我算公家的吗”。',
        '字是一个小孩写的。'
      ]
    },
    {
      paras: [
        '你想了想，决定先做点别的准备。',
        '你把台灯的角度调低了一点，光只照亮桌面，房间其余部分沉进暗里。',
        '这样，站在暗处的东西就不那么容易看清楚你手里在做什么。'
      ]
    }
  ];

  /* ── 主入口 ─────────────────────────────────────────── */

  function respond(state, rawInput) {
    const input = String(rawInput || '').trim();
    state.turns += 1;

    const r = result();

    // 意图匹配
    let hit = null;
    for (const it of INTENTS) {
      if (it.match.test(input)) { hit = it; break; }
    }

    if (hit) {
      hit.run(state, r);
    } else {
      const fb = pick(FALLBACKS, state.turns * 7 + state.minutes);
      narr(r, ...fb.paras.map(p => p.replace('${turns}', state.turns)));
      // 兜底也给一点方向感
      if (state.turns % 3 === 0) {
        sys(r, '提示：把你想查看的东西说得具体些（楼层、房号、物件名），楼会更愿意翻给你看。', 'warn');
      }
    }

    applyEffects(state, r);
    return r;
  }

  /* ── 效果结算 ───────────────────────────────────────── */

  function applyEffects(state, r) {
    const e = r.effects || {};

    // 时间
    const cost = e.minutes != null ? e.minutes : MIN_GAIN + (state.turns % (MAX_GAIN - MIN_GAIN + 1));
    const before = state.minutes;
    state.minutes = clamp(state.minutes + cost, 0, TOTAL_MINUTES);

    // 清醒 / 记录
    if (e.clarity) {
      state.clarity = clamp(state.clarity + e.clarity, 0, 100);
    }
    if (e.records) {
      state.records = clamp(state.records + e.records, 0, 100);
    }

    // 守则
    if (e.rules) {
      e.rules.forEach(id => { if (!state.rules.includes(id)) state.rules.push(id); });
      state.records = clamp(state.records + 3 * e.rules.length, 0, 100);
    }

    // 物品
    if (e.items) {
      Object.entries(e.items).forEach(([id, delta]) => {
        state.items[id] = clamp((state.items[id] || 0) + delta, 0, 99);
      });
    }

    // 标记
    if (e.flag) state.flags[e.flag] = true;
    if (e.flags) Object.assign(state.flags, e.flags);

    // 幕推进
    const prevAct = state.act;
    state.act = actOf(state.minutes).id;
    if (state.act !== prevAct && state.act !== 'end') {
      const act = ACTS.find(a => a.id === state.act);
      sys(r, `${act.label}。${act.scene}`, 'warn');
    }

    // 终局
    if (state.minutes >= TOTAL_MINUTES && !state.ending) {
      state.ending = resolveEnding(state);
      r.blocks.push({ type: 'ending', ending: state.ending });
    }

    // 记录时间
    r.time = clockText(state.minutes);
    r.cost = cost;
    r.advanced = state.minutes - before;
  }

  /* ── 结局判定 ───────────────────────────────────────── */

  function resolveEnding(s) {
    const known = s.rules.length;
    if (s.clarity >= 60 && known >= 11) {
      return {
        id: 'dawn-clear',
        title: '结局 · 天亮以后',
        lines: [
          '六点整，楼外的车声穿过天井，把整栋楼从里面推醒。',
          '你站起来，膝盖发出一声很轻的响，像那口挂钟在半夜里的犹豫。',
          '交接单摊在桌上。你写：“十二人在册，一人值守，无异常。”',
          '写完你抬头，看见镜子里那个人也在收笔。他比你老一点，眼神比你现在松。',
          '他先站起来，把椅子推回原位，替你把台灯关了。',
          '“走吧，”他说，声音在走廊里落下，一点一秒后回来，“下班了。”'
        ]
      };
    }

    if (s.clarity <= 20) {
      return {
        id: 'dawn-lost',
        title: '结局 · 第四十任',
        lines: [
          '五点多的时候你已经分不清哪些声音是自己的。',
          '六点的钟响了六下。你听见门厅那边有人进来，脚步声很轻，走得很稳，像走过很多遍这条路。',
          '他站在你桌子前面，看着你，很客气地问：“请问，交接找谁？”',
          '你张开嘴，想说你也没等到接班的人。',
          '可你听见自己的声音说：“找我。我是上一任。”'
        ]
      };
    }

    return {
      id: 'dawn-quiet',
      title: '结局 · 没有交接单的早晨',
      lines: [
        '六点整。挂钟响了六下，第七下迟迟没有来。',
        '你走到门口，门开着，外面是白的，白得没有层次，像一张曝光过度的照片。',
        '你踏出去的时候，听见身后整栋楼同时松了一口气——一百四十四扇窗，或者更多。',
        '你回头看了一眼值守室。台灯还亮着，桌上摊着记录簿，本子翻在扉页。',
        '那行红笔字下面，多了一行新的：**“第三十九任，已交班。”**',
        '字迹和你的一模一样。'
      ]
    };
  }

  /* ── 开场叙述 ───────────────────────────────────────── */

  function opening() {
    return [
      {
        type: 'stamp',
        time: '00:00',
        who: '交接',
        chip: '值守开始',
        paras: [
          '上一个值守员走得很急，连搪瓷杯里的水都没倒。',
          '交接单上只有一行字：**照守则做**。字下面画了一道线，线画了三遍。'
        ]
      },
      {
        type: 'narr',
        time: '00:00',
        who: '值守室',
        chip: '第一幕',
        paras: [
          '你坐下。椅子比看上去更旧，坐下去的时候发出很长的一声，像有人在你背后叹气。',
          '你没有回头。倒不是因为守则第五条，而是因为——才刚坐下就回头，显得很没经验。'
        ]
      },
      {
        type: 'rule',
        time: '00:00',
        who: '门厅',
        chip: '墙上',
        rule: RULES[0],
        extra: '蓝底白字的搪瓷牌一共七条，一到七，挂在值守室门内侧。你还没读完第八条——因为第八条不在墙上。'
      },
      {
        type: 'narr',
        time: '00:00',
        who: '值守室',
        chip: '第一幕',
        paras: [
          '现在是零点。距离天亮六小时。',
          '登记簿摊在桌上，翻到第六页。第六页只有一行很旧的字：**今天多了一个人，我没敢数第二次。**'
        ]
      }
    ];
  }

  /* ── 随场景变化的快捷选项 ───────────────────────────── */

  function choices(state) {
    const base = [];
    if (!state.flags.elevator13) base.push({ label: '去电梯那边看看', icon: 'i-door' });
    else if (!state.flags.key307) base.push({ label: '回到电梯，闭眼按那颗按钮', icon: 'i-fingerprint' });

    if (!state.flags.counted13) base.push({ label: '打开登记簿清点人数', icon: 'i-book' });
    else base.push({ label: '再看一眼登记簿最后一页', icon: 'i-book' });

    if (!state.flags.mirrorDone) base.push({ label: '抬头看值守室那面镜子', icon: 'i-eye' });
    if (!state.flags.stairsLamp) base.push({ label: '推开楼梯间的门', icon: 'i-stairs' });

    if (state.minutes >= 110 && !state.flags.met302) base.push({ label: '上三楼，敲三〇二的门', icon: 'i-users' });
    if (!state.flags.met501) base.push({ label: '去五〇一找陆知白', icon: 'i-key' });
    if (!state.flags.radioDone) base.push({ label: '让收音机响完', icon: 'i-radio' });
    if (!state.flags.wroteRecord) base.push({ label: '翻开记录簿写字', icon: 'i-scroll' });

    return base.slice(0, 4);
  }

  /* ── 对外 ───────────────────────────────────────────── */

  return {
    newState,
    respond,
    opening,
    choices,
    clockText,
    shiftName,
    actOf,
    TOTAL_MINUTES
  };
})();
