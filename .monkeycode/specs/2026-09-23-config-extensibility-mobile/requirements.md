# Requirements Document — 设置可扩展 + 移动端适配 + 前端技术强化

## Introduction

在线客服 Agent 当前的「管理中心」已能编辑 LLM/检索/上下文/记忆/工具开关/知识库/数据/记忆表/注入日志，但存在三个短板：
1. **内部功能可自定义性不足**：工具集（query_order / initiate_refund / lookup_policy）是硬编码 Python 函数；`char_budget`、`react_steps`、`top_p` 等参数在配置中心存在但界面无控件；注入护栏只有 7 条写死的正则；引擎模式（rule vs llm）只能靠环境变量间接切换。
2. **无移动端适配**：坐席工作台与设置中心是固定 2 列桌面网格，手机访问不可用；访客对话在 <960px 直接隐藏侧栏，丢功能。
3. **前端技术较原始**：raw `fetch` + 15s 轮询、分散 `useState`+`localStorage`、3 个手写 CSS 文件、无懒加载/代码分割、无类型。

本特性在保持现有视觉风格（豆包设计系统）的前提下，提升内部功能可自定义性、补齐移动端、并引入 2026 主流前端技术。

## Glossary

- **工具注册表（Tool Registry）**：可增删改查的 Agent 工具定义集合，每条含名称/参数 schema/描述/开关，驱动检索提示与 ReAct 工具调用。
- **注入规则（Injection Rule）**：一条注入检测正则或关键词，命中即拦截并写入 `injection_log`。
- **引擎模式（Engine Mode）**：`rule`（纯规则 ReAct）、`llm`（OpenAI 兼容 LLM 驱动 ReAct）、`auto`（有 Key 走 llm 否则回退 rule）三态。
- **参数控件（Param Control）**：管理中心里对单个可配置参数（滑块/开关/文本/下拉）的编辑 UI。
- **底部 Tab（Mobile Bottom Tab）**：移动端全局导航，置于视口底部固定。
- **侧滑抽屉（Slide Drawer）**：从屏幕一侧滑出的全屏/半屏面板，移动端承载侧栏内容。

## Requirements

### Requirement 1 — 可配置工具注册表

**User Story:** AS 管理员，I want 在管理中心增删改 Agent 工具（名称/参数/描述/启用开关），so that 无需改代码即可扩展客服可自动执行的动作（如查会员等级、创建售后工单）。

#### Acceptance Criteria

1. WHEN 管理员在工具注册表新增一条工具（名称 + JSON 参数 schema + 描述）并保存，管理中心 SHALL 持久化到数据库并即时在 `/api/agent/health` 的 `tools` 列表与 LLM 工具 schema 中体现。
2. WHEN 管理员关闭某工具开关，Agent 在下一轮对话 SHALL 不再把该工具注入 LLM 工具列表，规则路由也 SHALL 不再匹配该工具。
3. IF 管理员提交的参数 schema 不是合法 JSON 或字段名冲突，管理中心 SHALL 返回 400 并给出具体字段错误，不写入。
4. WHILE 工具注册表为空（全部停用或删除），Agent SHALL 回退为纯 RAG + 转人工兜底，不报错。
5. WHEN 内置的 `query_order` / `initiate_refund` / `lookup_policy` 被删除，Agent 的 ReAct 引擎 SHALL 通过注册表动态解析剩余工具，行为不依赖硬编码函数名。

### Requirement 2 — 注入护栏规则可配置

**User Story:** AS 管理员，I want 在管理中心增删改注入检测规则（正则/关键词 + 动作），so that 可随业务调整拦截口径而不重启服务。

#### Acceptance Criteria

1. WHEN 管理员新增一条注入规则（匹配表达式 + 动作 `block|log_only`）并保存，Agent SHALL 在下一轮输入检测时即按新规则生效，无需重启。
2. WHEN 一条 `block` 规则命中，Agent SHALL 写入 `injection_log`（含命中规则 id）并以护栏话术拒绝，不执行请求。
3. WHEN 一条 `log_only` 规则命中，Agent SHALL 记录但不阻断，正常走对话流程。
4. IF 管理员保存的规则表达式非法（正则编译失败），管理中心 SHALL 拒绝保存并提示。
5. WHILE 注入规则全部停用，Agent SHALL 保留 7 条内置默认规则作为兜底，护栏不失效。

### Requirement 3 — 参数控件补齐 + 引擎模式切换

**User Story:** AS 管理员，I want 在管理中心调整 `char_budget`、`react_steps`、`top_p` 以及 rule/llm/auto 引擎模式，so that 可在界面对 Agent 推理深度与引擎做即时调优。

#### Acceptance Criteria

1. WHEN 管理员拖动 `char_budget` 滑块并保存，上下文构建 SHALL 按新字符预算裁剪拼接的历史与 KB 内容。
2. WHEN 管理员调整 `react_steps` 数值并保存，ReAct 循环 SHALL 按新的最大步数执行。
3. WHEN 管理员把引擎模式设为 `rule`，Agent SHALL 强制走规则 ReAct，即使用户配置了 LLM Key；设为 `llm` 且无 Key 时，Agent SHALL 返回 503 并提示配置 Key；设为 `auto` SHALL 沿用现有「有 Key 走 llm 否则回退」逻辑。
4. WHILE 引擎模式为 `llm` 或 `auto` 且 LLM 调用失败，Agent SHALL 自动降级到 rule 模式并在响应 `mode` 字段标注 `rule_fallback`。

### Requirement 4 — 移动端响应式适配

**User Story:** AS 访客/坐席（手机用户），I want 在手机浏览器上正常完成对话、坐席接管与设置管理，so that 移动端也能使用系统。

#### Acceptance Criteria

1. WHILE 视口宽度 < 640px（手机），访客对话页 SHALL 把左侧会话栏收纳进可呼出的侧滑抽屉，并在视口底部渲染固定底部 Tab（对话/坐席/设置）。
2. WHILE 视口宽度 < 900px，坐席工作台与设置中心 SHALL 折叠为单列堆叠（队列/对话 上下分布），输入区固定于视口底部。
3. IF 用户在移动端点底部 Tab 切换页面，系统 SHALL 保持各页滚动位置与未发送输入草稿（不丢失）。
4. WHILE 移动端键盘弹起遮挡输入区，系统 SHALL 把输入区保持在可视范围内（不被遮挡）。

### Requirement 5 — 前端主流技术强化

**User Story:** AS 工程师/未来维护者，I want 前端采用 2026 主流技术栈与工程实践，so that 数据获取、状态管理、样式、性能、类型都达到现代水准。

#### Acceptance Criteria

1. WHEN 页面需要服务端数据，前端 SHALL 通过 TanStack Query（`useQuery`/`useMutation`/失效-重取）获取，替代裸 `fetch` 与 15s 轮询（改用 query 的 `refetchInterval` 或事件驱动）。
2. WHILE 多个组件共享全局会话/坐席/配置状态，系统 SHALL 用 zustand 单例 store 持有，组件按需 selector 订阅，避免跨组件 prop drilling 与重复请求。
3. WHEN 路由切换加载某页面组件，系统 SHALL 用 `React.lazy` + `Suspense` 做路由级代码分割，各页面为独立 chunk。
4. WHILE 列表数据增长（消息流/记忆表/注入日志），系统 SHALL 对长列表做 memo 化与受控渲染，避免全量重渲染；纯展示组件用 `React.memo` 包裹。
5. WHEN 使用 Tailwind 原子类编写新样式时，系统 SHALL 与现有豆包设计 token（品牌色、圆角、阴影）共存，不破坏既有视觉；旧 CSS 文件逐步替换为原子类。
6. IF 构建产物出现类型错误（启用 TypeScript 后），系统 SHALL 在 CI/构建阶段失败，不产出可运行产物。
7. WHEN 用户操作保存类 mutation 后，TanStack Query 缓存 SHALL 自动失效相关 query，UI 立即反映新数据，无需手动刷新。

## Out of Scope

- 后端鉴权/多租户（当前单租户，管理员界面不做登录）。
- 工具执行的真实外部 API 对接（工具仍是 stub，仅 schema 可配）。
- 图片上传对象存储化（仍走 base64）。
