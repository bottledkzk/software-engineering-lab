#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""make_demo_pptx.py —— 生成《星尘消除》小组演示 PPT（14 页，16:9，深色主题，含演讲备注）

用法：
    python tools/make_demo_pptx.py "选题一_益智消除网页游戏/演示材料/02_演示PPT.pptx"
"""
import sys
from lxml import etree
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Inches, Pt

# ---------- 主题 ----------
BG = RGBColor(0x0F, 0x0D, 0x24)
CARD = RGBColor(0x1E, 0x1A, 0x44)
CARD2 = RGBColor(0x26, 0x20, 0x57)
LINE = RGBColor(0x32, 0x2A, 0x6B)
TEXT = RGBColor(0xEC, 0xE9, 0xFF)
MUTED = RGBColor(0xA7, 0x9F, 0xD8)
ACCENT = RGBColor(0x7C, 0x6C, 0xFF)
ACCENT2 = RGBColor(0x9B, 0x8C, 0xFF)
GOLD = RGBColor(0xFF, 0xD1, 0x66)
GREEN = RGBColor(0x4A, 0xD9, 0xA4)
FONT = "微软雅黑"

W, H = 13.333, 7.5


def set_run(run, size=16, bold=False, color=TEXT, font=FONT):
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = color
    run.font.name = font
    rPr = run._r.get_or_add_rPr()
    ea = rPr.find(qn("a:ea"))
    if ea is None:
        ea = etree.SubElement(rPr, qn("a:ea"))
    ea.set("typeface", font)


def new_slide(prs, notes=""):
    slide = prs.slides.add_slide(prs.slide_layouts[6])       # 空白版式
    bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Inches(W), Inches(H))
    bg.fill.solid(); bg.fill.fore_color.rgb = BG
    bg.line.fill.background(); bg.shadow.inherit = False
    if notes:
        slide.notes_slide.notes_text_frame.text = notes
    return slide


def textbox(slide, left, top, width, height, text, size=18, bold=False, color=TEXT,
            align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, line_spacing=1.25):
    box = slide.shapes.add_textbox(Inches(left), Inches(top), Inches(width), Inches(height))
    tf = box.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = Inches(0.05)
    tf.margin_top = tf.margin_bottom = Inches(0.02)
    tf.vertical_anchor = anchor
    for i, line in enumerate(str(text).split("\n")):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        p.line_spacing = line_spacing
        r = p.add_run(); r.text = line
        set_run(r, size, bold, color)
    return box


def card(slide, left, top, width, height, fill=CARD):
    shp = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(left), Inches(top), Inches(width), Inches(height))
    shp.fill.solid(); shp.fill.fore_color.rgb = fill
    shp.line.color.rgb = LINE; shp.line.width = Pt(0.75)
    shp.shadow.inherit = False
    shp.adjustments[0] = 0.06
    return shp


def header(slide, kicker, title):
    textbox(slide, 0.7, 0.45, 12, 0.4, kicker, size=12, color=ACCENT2)
    textbox(slide, 0.7, 0.8, 12, 0.7, title, size=30, bold=True)
    bar = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.72), Inches(1.52), Inches(0.9), Inches(0.05))
    bar.fill.solid(); bar.fill.fore_color.rgb = ACCENT; bar.line.fill.background(); bar.shadow.inherit = False


def bullets(slide, left, top, width, items, size=16, gap=0.5, bullet="•", color=TEXT):
    y = top
    for it in items:
        textbox(slide, left, y, width, gap, f"{bullet} {it}", size=size, color=color)
        y += gap


def kpi(slide, left, top, width, height, value, label, accent=ACCENT2):
    card(slide, left, top, width, height, CARD)
    textbox(slide, left, top + 0.18, width, 0.7, value, size=34, bold=True, color=accent, align=PP_ALIGN.CENTER)
    textbox(slide, left, top + 0.92, width, 0.5, label, size=13, color=MUTED, align=PP_ALIGN.CENTER)


def table(slide, left, top, width, height, rows, col_widths, header_size=12, body_size=11):
    shape = slide.shapes.add_table(len(rows), len(rows[0]), Inches(left), Inches(top), Inches(width), Inches(height))
    tbl = shape.table
    for ci, cw in enumerate(col_widths):
        tbl.columns[ci].width = Inches(cw)
    for ri, row in enumerate(rows):
        for ci, val in enumerate(row):
            cell = tbl.cell(ri, ci)
            cell.margin_left = cell.margin_right = Inches(0.06)
            cell.margin_top = cell.margin_bottom = Inches(0.03)
            cell.vertical_anchor = MSO_ANCHOR.MIDDLE
            cell.fill.solid()
            cell.fill.fore_color.rgb = CARD2 if ri == 0 else CARD
            tf = cell.text_frame
            tf.word_wrap = True
            p = tf.paragraphs[0]
            r = p.add_run(); r.text = str(val)
            set_run(r, header_size if ri == 0 else body_size, bold=(ri == 0),
                    color=GOLD if ri == 0 else TEXT)
    return tbl


def build(path):
    prs = Presentation()
    prs.slide_width = Inches(W)
    prs.slide_height = Inches(H)

    # ---------- 1 封面 ----------
    s = new_slide(prs, "开场（约 30 秒）：先给结论——纯前端、零依赖、可离线，需求到验证四件套齐全，170 项自动化断言全部通过。然后说“下面先讲需求和设计，再现场操作”。")
    glow = s.shapes.add_shape(MSO_SHAPE.OVAL, Inches(8.4), Inches(-1.2), Inches(6), Inches(6))
    glow.fill.solid(); glow.fill.fore_color.rgb = RGBColor(0x22, 0x1A, 0x52)
    glow.line.fill.background(); glow.shadow.inherit = False
    textbox(s, 0.9, 1.9, 8.5, 1.1, "星尘消除", size=58, bold=True)
    textbox(s, 0.95, 3.05, 8.5, 0.5, "轻量级益智消除类网页游戏", size=22, color=ACCENT2)
    textbox(s, 0.95, 3.6, 9.2, 0.5, "需求分析 → 系统设计 → 代码实现 → 自动化验证", size=15, color=MUTED)
    card(s, 0.9, 4.55, 5.6, 0.95, CARD)
    textbox(s, 1.1, 4.72, 5.3, 0.6, "零依赖 · 可离线 · 170 项断言全部通过", size=15, color=GOLD)
    textbox(s, 0.95, 5.95, 8.5, 0.4, "小组演示 · 邓淇阳（U202414805）/ 【成员B】", size=14, color=TEXT)
    textbox(s, 0.95, 6.35, 8.5, 0.4, "2026 年 10 月 · 软件工程 3.0", size=13, color=MUTED)

    # ---------- 2 问题与目标 ----------
    s = new_slide(prs, "三个痛点各一句话，不要展开；重点落在“所以我们的目标是打开就能玩一局”。范围外的 11 项如果被问到再讲。")
    header(s, "01 / 为什么做", "三个真实痛点，一个克制目标")
    pains = [("必须联网", "地铁、飞行模式、弱网下直接玩不了"),
             ("广告打断", "看广告换道具，一局被打断多次"),
             ("体力限制", "体力用完即止，想玩也玩不了")]
    for i, (t, d) in enumerate(pains):
        x = 0.72 + i * 4.13
        card(s, x, 2.0, 3.9, 1.5)
        textbox(s, x + 0.25, 2.2, 3.4, 0.45, t, size=20, bold=True, color=GOLD)
        textbox(s, x + 0.25, 2.72, 3.4, 0.7, d, size=13, color=MUTED)
    card(s, 0.72, 3.85, 11.9, 1.35, CARD2)
    textbox(s, 1.0, 4.02, 11.3, 0.45, "产品目标：打开就能玩一局（5～10 分钟），全程不需要联网", size=20, bold=True)
    textbox(s, 1.0, 4.52, 11.3, 0.55, "差异化 = 完全离线可玩 + 无广告无体力 + 本地排行榜；不做账号、内购、在线榜等 11 项（见需求文档范围外清单）", size=13, color=MUTED)
    kpi(s, 0.72, 5.55, 2.8, 1.25, "30 关", "3 章 × 10 关")
    kpi(s, 3.75, 5.55, 2.8, 1.25, "3 种道具", "洗牌 / 锤子 / +5 步")
    kpi(s, 6.78, 5.55, 2.8, 1.25, "2 类目标", "计分 / 消除指定色")
    kpi(s, 9.81, 5.55, 2.8, 1.25, "0 依赖", "零第三方库、零构建")

    # ---------- 3 用户 ----------
    s = new_slide(prs, "三类画像对应三种使用场景，后面界面设计（引导、低打扰排行榜、选关页星级）都是由画像推出来的。")
    header(s, "02 / 给谁做", "三类用户画像，覆盖三种使用场景")
    users = [("碎片时间型", "课间 5～10 分钟，一局即走", "主菜单「继续」一键进关；无强制引导"),
             ("冲星型", "在意星级与最高分", "选关页显示每关星级；结算显示星级与新纪录"),
             ("比分型", "和舍友比成绩", "本地总星榜 / 单关榜；局内不弹排名提示")]
    for i, (t, d, r) in enumerate(users):
        y = 1.95 + i * 1.62
        card(s, 0.72, y, 11.9, 1.35)
        textbox(s, 1.0, y + 0.18, 3.2, 0.5, t, size=19, bold=True, color=ACCENT2)
        textbox(s, 1.0, y + 0.72, 4.6, 0.45, d, size=13, color=MUTED)
        textbox(s, 5.9, y + 0.42, 6.5, 0.6, "界面应对：" + r, size=14, color=TEXT)

    # ---------- 4 需求基线 ----------
    s = new_slide(prs, "三组数字要念清楚：20 条功能、22 条非功能、37 条验收；再加“明确不做 11 项”，体现范围控制。非功能里点出首屏、帧率、离线、存档可靠性四项。")
    header(s, "03 / 需求基线", "20 条功能 · 22 条非功能 · 37 条验收标准")
    kpi(s, 0.72, 1.95, 2.6, 1.25, "20", "功能需求 FR-01~20", ACCENT2)
    kpi(s, 3.45, 1.95, 2.6, 1.25, "22", "非功能需求 NFR", GREEN)
    kpi(s, 6.18, 1.95, 2.6, 1.25, "37", "验收用例 AC-01~37", GOLD)
    kpi(s, 8.91, 1.95, 3.7, 1.25, "11 项", "明确不做的范围外事项", MUTED)
    card(s, 0.72, 3.5, 11.9, 2.5)
    textbox(s, 1.0, 3.68, 11.3, 0.4, "关键非功能指标（全部可度量、可验证）", size=15, bold=True, color=ACCENT2)
    bullets(s, 1.0, 4.15, 11.3, [
        "首屏可交互 ≤ 2 s（4G、中端机；关键资源 gzip ≤ 1.2 MB）　·　运行帧率 ≥ 50 fps　·　操作响应 ≤ 100 ms",
        "存档写入成功率 100%（连续 200 次 0 失败）；损坏先备份再重置，写失败必须提示",
        "首次加载后断网可完整游玩（离线资源缓存）；存储不可用时降级运行、不白屏",
        "色觉友好（颜色 + 形状双编码）；音效可完全关闭；全中文文案",
    ], size=13, gap=0.42)

    # ---------- 5 架构 ----------
    s = new_slide(prs, "只讲一个取舍：纯逻辑领域层。因为它决定了“玩法能在 Node 里跑断言”。四层从下往上说，或者从上往下都行，30～40 秒讲完。")
    header(s, "04 / 架构", "四层分层，玩法规则挤在不依赖浏览器的领域层")
    layers = [("表现层 ARCH-01", "ui.js：Canvas 渲染 · 输入（点击/拖拽/键盘）· 动画 · 引导", 0.95),
              ("应用层 ARCH-02", "main.js：状态机 · 流程编排 · 结算与排行榜 · 存档时机", 0.9),
              ("领域层 ARCH-03（纯逻辑）", "board / score / levels / config：规则唯一实现，Node 可直接测", 1.0),
              ("基础设施层 ARCH-04", "storage / audio / sw：存档 · 音效 · 离线缓存（可注入替换）", 0.9)]
    for i, (t, d, alpha) in enumerate(layers):
        y = 1.95 + i * 1.18
        fill = CARD2 if i == 2 else CARD
        card(s, 0.72, y, 8.2, 1.0, fill)
        textbox(s, 0.95, y + 0.12, 7.8, 0.4, t, size=16, bold=True,
                color=ACCENT2 if i != 2 else GOLD)
        textbox(s, 0.95, y + 0.55, 7.8, 0.35, d, size=12, color=MUTED)
    card(s, 9.2, 1.95, 3.4, 4.45, CARD)
    textbox(s, 9.45, 2.15, 2.95, 0.4, "依赖规则", size=15, bold=True, color=GOLD)
    bullets(s, 9.45, 2.6, 2.95, [
        "单向依赖、无环（矩阵可查）",
        "领域层不碰 DOM",
        "平台能力收敛在 storage 注入",
        "随机性可注入（种子可复现）",
        "状态单向流动",
    ], size=12, gap=0.62, bullet="—")
    textbox(s, 0.72, 6.75, 11.9, 0.4, "为什么这样分：规则与界面解耦后，计分/消除/洗牌可以脱离浏览器验证——这是 170 项断言能跑起来的前提。",
            size=12, color=MUTED)

    # ---------- 6 模块与接口 ----------
    s = new_slide(prs, "9 个模块一句话带过，重点讲接口一致性这一条：设计文档写了 51 条接口，测试逐条比对代码里有没有同名导出。这正是老师反馈里建议的“纳入门禁”。")
    header(s, "05 / 模块与接口", "9 个模块 · 51 条接口 · 接口清单与代码自动比对")
    rows = [["模块", "职责", "接口数"],
            ["config / score / levels", "常量 · 计分星级 · 关卡配置与校验", "17"],
            ["board", "棋盘、交换、连锁、特殊方块、洗牌、道具", "18"],
            ["storage", "存档校验、归一化、迁移、原子写、降级", "4"],
            ["audio / ui", "音效合成 · Canvas 渲染与输入", "11"],
            ["main", "状态机、编排、结算、排行榜", "9"],
            ["sw", "预缓存、缓存优先、版本清理", "4"]]
    table(s, 0.72, 1.95, 7.9, 3.6, rows, [2.5, 4.4, 1.0], header_size=12, body_size=11)
    card(s, 8.9, 1.95, 3.7, 3.6, CARD)
    textbox(s, 9.15, 2.15, 3.2, 0.4, "接口一致性门禁", size=15, bold=True, color=GOLD)
    bullets(s, 9.15, 2.6, 3.2, [
        "解析设计文档 §6.1 的 51 条接口",
        "逐条在对应模块里找同名导出",
        "51/51 全部匹配，0 遗漏",
        "改名/漏实现会直接失败",
    ], size=12, gap=0.66, bullet="—")
    textbox(s, 0.72, 5.85, 11.9, 1.0, "另：接口按“引入批次”编号，模块内编号不一定连续——文档里有「模块 → API 编号对照表」，保证第 4 章声明数与第 6 章表格逐条一致。",
            size=12, color=MUTED)

    # ---------- 7 设计决策 ----------
    s = new_slide(prs, "挑 4 个决策讲，每个都是“备选 → 为什么否决 → 选了什么”。老师通常就爱问这类。若时间紧，只讲前两个。")
    header(s, "06 / 设计决策", "四个被反复权衡的取舍（含被否决方案）")
    decs = [("纯逻辑领域层", "否决：逻辑与 DOM 混合（无法自动测、改动风险高）", "玩法可在 Node 直接断言"),
            ("零依赖零构建", "否决：Vite 打包 / React（无依赖可打包，只增复杂度）", "制品即源码，可离线、体积可控"),
            ("Canvas 2D 渲染", "否决：DOM+CSS 动画（低端掉帧）/ WebGL（过度设计）", "81 格方块，2D 足够且稳定"),
            ("构造式洗牌", "否决：随机重排+拒绝采样（3 色下几乎必然失败）", "保证“无连线+可玩”，不破坏预期")]
    for i, (t, veto, why) in enumerate(decs):
        x = 0.72 + (i % 2) * 6.1
        y = 1.95 + (i // 2) * 2.3
        card(s, x, y, 5.85, 2.05)
        textbox(s, x + 0.25, y + 0.14, 5.3, 0.4, t, size=17, bold=True, color=ACCENT2)
        textbox(s, x + 0.25, y + 0.62, 5.3, 0.7, veto, size=12, color=MUTED)
        textbox(s, x + 0.25, y + 1.35, 5.3, 0.5, "→ " + why, size=13, color=GREEN)

    # ---------- 8 数据与一致性 ----------
    s = new_slide(prs, "数据这一页只讲“一致性怎么保证”：单键、原子写、备份、归一化、迁移。多标签页那句可以留给提问。")
    header(s, "07 / 数据与一致性", "一个存档键，五道保险")
    items = [("单键 JSON", "version / 昵称 / 解锁 / 金币 / 道具 / 星数 / 最好分 / 两榜 / 设置"),
             ("原子写", "先写临时键 → 覆盖正式键 → 删临时键，避免写一半损坏"),
             ("损坏恢复", "解析或结构失败 → 原文备份到 *_corrupt_<时间戳> → 重置并提示"),
             ("归一化规则表", "14 个字段逐一给出“缺省值 / 缺失时行为 / 非法时行为”"),
             ("版本迁移", "整数版本对应 SemVer 的 MAJOR：不兼容变更才递增并迁移，失败走损坏流程")]
    for i, (t, d) in enumerate(items):
        y = 1.95 + i * 0.92
        card(s, 0.72, y, 11.9, 0.8)
        textbox(s, 1.0, y + 0.15, 3.0, 0.5, t, size=16, bold=True, color=GOLD)
        textbox(s, 3.9, y + 0.2, 8.5, 0.5, d, size=12.5, color=TEXT)
    textbox(s, 0.72, 6.85, 11.9, 0.4, "另外：同浏览器多标签页以最后写入为准（last-write-wins），不做跨页实时同步——明确写在数据设计里。",
            size=12, color=MUTED)

    # ---------- 9 异常与降级 ----------
    s = new_slide(prs, "12 种故障模式压缩成 4 条原则，讲原则就行。用户可见的三类提示：顶部横幅、页面内提示、设置页状态。")
    header(s, "08 / 异常与降级", "12 种故障模式，4 条处理原则")
    principles = [("不白屏", "任何能力缺失都降级为“可玩但不完美”"),
                  ("先备份再告知", "数据类故障：备份 → 重置 → 明确提示"),
                  ("循环必须有上限", "初始化 50 次、洗牌 80 次、兜底 500 次、跨轮 5 次"),
                  ("提示不用技术语言", "不出现异常堆栈与英文错误码")]
    for i, (t, d) in enumerate(principles):
        x = 0.72 + (i % 2) * 6.1
        y = 1.95 + (i // 2) * 1.35
        card(s, x, y, 5.85, 1.15)
        textbox(s, x + 0.25, y + 0.14, 5.3, 0.4, f"{i+1}. {t}", size=17, bold=True, color=ACCENT2)
        textbox(s, x + 0.25, y + 0.62, 5.3, 0.45, d, size=12.5, color=TEXT)
    card(s, 0.72, 4.85, 11.9, 1.75, CARD2)
    textbox(s, 1.0, 5.02, 11.3, 0.4, "典型降级路径（现场可演示）", size=14, bold=True, color=GOLD)
    bullets(s, 1.0, 5.45, 11.3, [
        "存储不可用（隐私模式/被禁用）→ 内存模式运行，设置页标注“进度仅本次有效”",
        "音效不可用（策略阻止）→ 全部音频接口空操作，界面不报错",
        "离线缓存不可用（非安全上下文/注册失败）→ 在线模式 + 设置页标注“离线不可用”",
    ], size=12.5, gap=0.36)

    # ---------- 10 演示路线 ----------
    s = new_slide(prs, "这一页是给自己看的路线图，可以快速带过，然后切到游戏。演示顺序：选关 → 交换与连锁 → 特殊方块（凑不出就切 1-1）→ 道具 → 结算 → 排行与设置 → 离线。")
    header(s, "09 / 现场演示", "七步演示路线（约 3 分半）")
    steps = [["#", "演示点", "看什么"],
             ["D1", "选关页", "3 章 30 关、星级、锁定态；配置驱动"],
             ["D2", "交换与连锁", "得分 = 20 × 连锁倍率；剩余步数折算"],
             ["D3", "特殊方块", "4 连→条纹、T 形→炸弹、5 连→彩虹、双特殊→十字"],
             ["D4", "三种道具", "洗牌 / 锤子（选格才扣费）/ +5 步"],
             ["D5", "结算", "总分、星级（过关至少 1 星）、金币奖励"],
             ["D6", "排行榜与设置", "两榜、低打扰、离线与音效状态、重置二次确认"],
             ["D7", "离线演练", "断网刷新仍可玩（Service Worker 预缓存）"]]
    table(s, 0.72, 1.95, 11.9, 3.9, steps, [0.9, 2.6, 8.4], header_size=12, body_size=11.5)
    textbox(s, 0.72, 6.05, 11.9, 0.9, "备用：若 D3 凑不出特殊方块，切 1-1（4 色棋盘更容易 4 连）；再不行切回本页讲规则 + 展示 board.js 的 SP 枚举。",
            size=12, color=MUTED)

    # ---------- 11 验证证据 ----------
    s = new_slide(prs, "证据墙：170 项断言 + 难度校准。念数字时慢一点：64、46、51、9；然后是 83.0%、44.9%、18%。强调“脚本可复现、种子固定”。")
    header(s, "10 / 验证", "170 项自动化断言全部通过，难度由模拟玩家校准")
    kpi(s, 0.72, 1.9, 2.6, 1.2, "64", "领域层断言", ACCENT2)
    kpi(s, 3.45, 1.9, 2.6, 1.2, "46", "应用层结算断言", GREEN)
    kpi(s, 6.18, 1.9, 2.6, 1.2, "51", "接口一致性", GOLD)
    kpi(s, 8.91, 1.9, 3.7, 1.2, "9", "页面接线校验", MUTED)
    card(s, 0.72, 3.35, 5.8, 2.4)
    textbox(s, 0.98, 3.52, 5.3, 0.4, "难度校准（模拟玩家）", size=15, bold=True, color=ACCENT2)
    bullets(s, 0.98, 3.95, 5.3, [
        "贪心玩家通关率 83.0%（630 局）",
        "休闲玩家通关率 44.9%",
        "通关局中三星占 18%",
        "0 星只出现在未过关局",
    ], size=13, gap=0.42, bullet="—")
    card(s, 6.8, 3.35, 5.82, 2.4)
    textbox(s, 7.05, 3.52, 5.3, 0.4, "怎么保证这些数字可信", size=15, bold=True, color=ACCENT2)
    bullets(s, 7.05, 3.95, 5.3, [
        "固定随机种子，连续两次运行结果一致",
        "断言清单与运行日志随包提供",
        "接口清单与代码导出自动比对",
        "验收分组（9 局/关）与校准（21 局/关）口径分别标注",
    ], size=13, gap=0.42, bullet="—")
    textbox(s, 0.72, 6.0, 11.9, 0.5, "结论：规则、结算、离线与降级路径都有可复跑的断言；性能与兼容类指标需真机，已给出基准设备与判定阈值（未实测的如实标注“待实测”）。",
            size=12, color=MUTED)

    # ---------- 12 工程实践 ----------
    s = new_slide(prs, "工程实践三条：文档即代码、四合一扫描、提交信息带验证结果。这条最能体现“过程规范”，也回应了老师对文档一致性的要求。")
    header(s, "11 / 工程实践", "文档即代码 · 交付前四合一扫描 · 变更全程留痕")
    practices = [("文档即代码", "Markdown 为唯一来源 → 脚本生成 Word → 结构校验输出随包；文档与代码同仓、同版本控制"),
                 ("四合一扫描", "编号自检 → 章节连续性 → 表间交叉引用 → 路径口径；每次增补后必跑，作为提交门禁"),
                 ("变更留痕", "15 项需求变更逐项写明：改了什么 / 为什么 / 影响哪几条 / 对设计的影响 / 如何验证"),
                 ("接口即契约", "代码里的函数名与设计文档的接口名一致；改名会让一致性测试失败（finish → onSettle 就是这么改的）")]
    for i, (t, d) in enumerate(practices):
        y = 1.95 + i * 1.22
        card(s, 0.72, y, 11.9, 1.05)
        textbox(s, 1.0, y + 0.12, 3.2, 0.4, t, size=16, bold=True, color=GOLD)
        textbox(s, 4.1, y + 0.18, 8.3, 0.7, d, size=12.5, color=TEXT)

    # ---------- 13 AI 协作边界 ----------
    s = new_slide(prs, "AI 部分如实讲：AI 做什么、人做什么、留痕在哪。老师最在意“是不是直接照搬”，我们就讲“每条结论都有人工核实与实测”。")
    header(s, "12 / AI 协作", "AI 负责检索与起草，人负责取舍与核实")
    card(s, 0.72, 1.95, 5.85, 3.3)
    textbox(s, 0.98, 2.12, 5.3, 0.4, "AI 承担的", size=15, bold=True, color=ACCENT2)
    bullets(s, 0.98, 2.55, 5.3, [
        "资料检索与同类产品梳理",
        "需求/设计文档起草与结构整理",
        "Markdown → Word 的格式转换与自查清单",
        "代码骨架与测试用例初稿",
    ], size=13, gap=0.6, bullet="—")
    card(s, 6.8, 1.95, 5.82, 3.3)
    textbox(s, 7.05, 2.12, 5.3, 0.4, "人工负责的", size=15, bold=True, color=GOLD)
    bullets(s, 7.05, 2.55, 5.3, [
        "需求取舍与 7 项明确否决（含理由）",
        "15 项需求变更的裁决与影响分析",
        "数值实测：模拟玩家校准、浏览器配额实测",
        "13 项关键结论的逐条核实（含截图证据）",
    ], size=13, gap=0.6, bullet="—")
    card(s, 0.72, 5.4, 11.9, 1.35, CARD2)
    textbox(s, 1.0, 5.58, 11.3, 0.9, "留痕：19 条提示词 / 16 轮迭代 / 7 项否决 / 15 项修改，全部记录在《02_AI协作记录》；\n人工核实记录在《03_人工核实说明》，含浏览器实测 5 张截图。", size=13.5, color=TEXT)

    # ---------- 14 分工与下一步 ----------
    s = new_slide(prs, "收尾：分工各一句，下一步三条。最后一句“谢谢，欢迎提问”就好，不要拖。")
    header(s, "13 / 分工与下一步", "两个人各管一半，下一步三件事")
    card(s, 0.72, 1.95, 5.85, 2.55)
    textbox(s, 0.98, 2.12, 5.3, 0.4, "邓淇阳", size=17, bold=True, color=ACCENT2)
    bullets(s, 0.98, 2.55, 5.3, ["需求分析与系统设计", "代码实现与自动化测试", "现场演示操作"], size=13, gap=0.52, bullet="—")
    card(s, 6.8, 1.95, 5.82, 2.55)
    textbox(s, 7.05, 2.12, 5.3, 0.4, "【成员B】", size=17, bold=True, color=GOLD)
    bullets(s, 7.05, 2.55, 5.3, ["PPT 与讲稿", "文档校对与材料归档", "答辩主答（架构/数据/测试）"], size=13, gap=0.52, bullet="—")
    card(s, 0.72, 4.7, 11.9, 1.6, CARD2)
    textbox(s, 1.0, 4.88, 11.3, 0.4, "下一步", size=14, bold=True, color=ACCENT2)
    bullets(s, 1.0, 5.3, 11.3, [
        "真机性能与兼容实测（首屏、帧率、内存、离线）—— 按设计文档 §9.2 的基准设备与阈值执行",
        "可用性测试：5 名同学无引导 5 分钟内过第 1 关（需求阶段遗留的 V-12 项）",
        "云存档与更多关卡：替换 storage 后端接口即可接入，架构上已预留",
    ], size=12.5, gap=0.34)
    textbox(s, 0.72, 6.55, 11.9, 0.5, "谢谢，欢迎提问。", size=18, bold=True, color=GOLD)

    prs.save(path)
    return path


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "02_演示PPT.pptx"
    print("OK", build(out))
