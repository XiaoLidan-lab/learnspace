---
name: LearnSpace
description: 自由组合工具、专注阅读与学习的本地优先工作台
colors:
  accent: "#4257d6"
  accent-hover: "#3447bb"
  accent-soft: "#eef1ff"
  canvas: "#f7f8fb"
  surface: "#ffffff"
  surface-soft: "#f1f3f8"
  ink: "#202637"
  text: "#3e4c63"
  muted: "#606d82"
  border: "#dde3ed"
  danger: "#b13f38"
  danger-soft: "#fff5f3"
  success: "#287057"
  success-soft: "#eef7f2"
  warning: "#86601b"
typography:
  heading:
    fontFamily: "DM Sans, Noto Sans SC, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "-0.025em"
  body:
    fontFamily: "DM Sans, Noto Sans SC, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "14px"
    lineHeight: 1.6
  reading:
    fontFamily: "DM Sans, Noto Sans SC, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "15px"
    lineHeight: 1.8
  label:
    fontSize: "13px"
    lineHeight: 1.5
  caption:
    fontSize: "12px"
    lineHeight: 1.65
rounded:
  control: "8px"
  panel: "12px"
  dialog: "16px"
spacing:
  tiny: "4px"
  small: "8px"
  compact: "12px"
  regular: "16px"
  section: "24px"
  page: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "7px 14px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
---

## Overview

**Creative North Star: "让内容成为学习空间的主角"**

沿用 LearnSpace 已有的白色模块、淡蓝紫画布和蓝色操作色。界面属于 Operate / Read：用户首先需要阅读资料、组织工具、看清 AI 结果，而非欣赏装饰。此次规范记录现有产品的渐进打磨，不替换导航、模块布局模型或业务行为。

**Key Characteristics:**

- 阅读内容优先，模块工具栏保持紧凑。
- 主要操作清楚，辅助信息安静但可读。
- 桌面组合画布与窄屏导航各自适配。

## Colors

前置 tokens 定义规范颜色；运行时对应 `src/design-tokens.css`。accent 用于当前导航、主要按钮与焦点，ink/text 用于标题和正文，muted 用于说明和占位文字。危险、成功状态使用各自语义颜色，同时保留文字说明。

**The Readability Rule.** 不通过极浅文字表达次要层级；优先调整字号、字重和间距。新辅助文字在白色背景的静态计算对比度为 5.24:1，在画布为 4.93:1；这不是全站 WCAG 认证。

## Typography

保留已有 DM Sans 与 Noto Sans SC 字体及系统后备。正文与模块标题使用 body；AI 结果与笔记使用 reading；标签与元数据使用 label/caption。手机表单输入保持（16px），避免系统自动放大。首页标题在窄屏降为（24px）。图形预览不是阅读正文，不承担信息传达。

**The Reading Measure Rule.** Markdown 阅读宽度最多（75ch），代码和表格保留自身滚动容器；长文件名、长结果不能挤走操作按钮。

## Layout

间距使用前置 scale。桌面页面边距采用 page，工具组内部采用 small/compact，独立段落采用 section。首页压缩介绍区域，让已保存工作台更早进入视野。宽度（1100px）以下模板两列，（700px）以下单列；（480px）以下收起品牌文字并保留带名称的标志链接。窄屏顶部提供工作台、社区、资料和设置入口。

工作台继续沿用现有网格、专注模式和尺寸持久化。此次不修改用户模块坐标，也不新增手机导航结构。桌面按钮不小于（32px）或（36px）；粗指针下主要按钮和常用图标目标至少（44px）。

## Elevation & Depth

普通工作台和模板卡片以轻边框分隔，不靠悬浮位移强调。弹出菜单和模态窗口使用有偏移的柔和阴影，具体值记录在 sidecar 与运行时 tokens。

**The Quiet Surface Rule.** 阴影只解释遮挡层级，不能代替信息层级；不增加装饰动画。既有短状态反馈尊重减少动态效果偏好。

## Shapes

控件、内容面板和模态窗口分别使用 control、panel、dialog 圆角。紧凑标签可以保留胶囊形态；正文区域不额外套装饰卡片。

## Components

- 按钮：主要操作使用 accent；次要操作为白底。hover 加深颜色，disabled 保留原语义并降低不透明度。
- 输入：可见标签、深色输入文字和可读占位文字；focus-visible 使用（2px）主色轮廓。聊天输入使用整组 focus-within。
- 导航：当前页同时有背景和文字状态；主导航标记 aria-current，提供跳到主要内容链接。
- 弹窗：共享焦点 hook 用于应用主弹窗、云端面板和模板保存。Tab/Shift+Tab 循环，Escape 尊重 busy 锁定，关闭后在可用时返回触发控件；嵌套菜单保留自身键盘处理。
- 状态：AI 无可计算总量时维持紧凑状态行；有真实进度时使用细进度条和百分比。错误说明保留原恢复路径，不能用装饰性假百分比。
- 模块：保留知识卡片紧凑尺寸、导图画布主导布局、聊天与测验流式行为。资料/笔记删除保留确认流程。

## Do's and Don'ts

- 保持阅读内容与关键操作可见。
- 用统一 tokens 定义共享颜色和尺寸。
- 在桌面、窄屏及键盘路径中验证修改。
- 不增加无必要的动画或装饰。
- 不用低对比度的小字隐藏必要信息。
- 不因视觉优化改变用户数据、模块布局或 AI 行为。

运行时加载顺序：原 styles / workbench → design-tokens → ui-polish。旧样式尚有历史尺寸和颜色；本轮通过共享覆盖层渐进统一，后续新增界面应直接使用 tokens。
