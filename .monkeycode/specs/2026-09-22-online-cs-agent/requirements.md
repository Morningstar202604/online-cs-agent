# 在线客服答疑 Agent - Requirements

## Introduction

本功能构建一个在线客服答疑 Agent，面向终端用户提供自助式即时问答。用户通过 Web 聊天界面提问，Agent 基于内置知识（FAQ 知识库 + LLM 生成）直接回答常见咨询（如物流、售后、账户、使用方法），减少人工坐席压力。技术栈为 Web 全栈（前后端分离 + /api 反向代理），Agent 大脑接入 OpenAI 兼容 LLM，通过检索增强（RAG）保证回答贴合知识库。

## Glossary

- **客服 Agent**: 本系统中回答用户咨询的智能体
- **访客 (Visitor)**: 通过 Web 聊天界面提问的终端用户
- **坐席 (Agent Operator)**: 当 Agent 无法解决时人工介入处理的人员
- **知识库 (Knowledge Base)**: 由 FAQ、产品说明、政策文档组成的结构化检索语料
- **会话 (Session)**: 访客与 Agent 的一次连续对话
- **工单 (Ticket)**: Agent 无法解决、升级给坐席处理的事项
- **LLM**: OpenAI 兼容接口的大语言模型

## Requirements

### Requirement 1: 自助问答

**User Story:** AS 访客, I want 直接向客服 Agent 提出咨询并获得即时回答, so that 我能快速解决问题而无需等待人工坐席。

#### Acceptance Criteria

1. WHEN 访客在聊天界面发送一条咨询消息, 客服 Agent SHALL 在 10 秒内返回一条文本回答。
2. WHEN 咨询命中知识库条目, 客服 Agent SHALL 在回答末尾标注所依据的知识库条目编号。
3. IF 访客未发送任何消息, 客服 Agent SHALL 主动展示一条欢迎语和不超过 5 条高频问题快捷入口。

### Requirement 2: 检索增强回答

**User Story:** AS 访客, I want Agent 的回答贴合产品真实信息, so that 我避免被模型编造的错误信息误导。

#### Acceptance Criteria

1. WHEN 客服 Agent 生成回答, 系统 SHALL 先从知识库中检索与问题最相关的 top-K 条目（K 默认 4），再将该条目作为上下文交给 LLM 生成回答。
2. IF 知识库检索结果为空, 系统 SHALL 向 LLM 明确告知无相关知识，并要求 LLM 告知访客将转人工坐席，而不是自行编造。
3. WHILE 会话进行中, 系统 SHALL 将最近 10 轮对话历史随上下文一并提供给 LLM，以保持多轮连贯。

### Requirement 3: 升级到人工坐席

**User Story:** AS 访客, I want 在 Agent 无法解决时转接人工, so that 复杂问题能由真人处理。

#### Acceptance Criteria

1. IF Agent 回答置信度低于阈值（默认 0.6）或访客明确输入"转人工", 系统 SHALL 将会话标记为待人工并展示"正在为您转接坐席"提示。
2. WHILE 会话处于待人工状态, 系统 SHALL 将会话及其最近 10 轮对话摘要展示给坐席工作台。
3. WHEN 坐席接管会话, 系统 SHALL 向访客展示"已接入坐席坐席编号"通知，并将后续消息直接路由给坐席。

### Requirement 4: 会话与工单持久化

**User Story:** AS 坐席, I want 会话与工单被完整记录, so that 我可以追踪、复盘与统计服务质量。

#### Acceptance Criteria

1. WHEN 会话结束或坐席关闭会话, 系统 SHALL 将会话 ID、访客标识、起止时间、消息序列、是否升级、升级原因写入持久化存储。
2. IF 升级产生工单, 系统 SHALL 为工单生成唯一编号、优先级与初始状态"待处理"，并关联原会话 ID。
3. WHEN 坐席处理工单, 系统 SHALL 记录处理时长与处理结论。

### Requirement 5: 坐席工作台

**User Story:** AS 坐席, I want 有一个工作台管理所有待处理会话与工单, so that 我能高效处理并回复访客。

#### Acceptance Criteria

1. WHEN 坐席登录工作台, 系统 SHALL 展示待接管的会话列表、待处理工单列表与坐席已接管会话。
2. WHEN 坐席对某会话发送回复, 系统 SHALL 将消息实时推送给对应访客端。
3. IF 坐席未接管任何会话, 坐席工作台 SHALL 展示空态提示与历史工单入口。

### Requirement 6: 访客端体验

**User Story:** AS 访客, I want 聊天界面清晰流畅, so that 我能快速理解 Agent 回复并继续追问。

#### Acceptance Criteria

1. WHEN 访客打开页面, 系统 SHALL 展示聊天窗口、消息气泡、输入框与"转人工"按钮。
2. WHILE Agent 生成回答过程中, 系统 SHALL 展示加载指示与打字提示，避免访客误以为卡死。
3. IF 网络中断, 系统 SHALL 展示重连提示并保留已发送消息的本地记录。

### Requirement 7: LLM 配置与安全

**User Story:** AS 管理员, I want LLM 凭据由项目自身管理, so that 我不会把平台密钥误带入项目。

#### Acceptance Criteria

1. WHILE 服务启动, 系统 SHALL 从项目自身的环境变量读取 LLM 凭据（USER_LLM_API_KEY / USER_LLM_BASE_URL / USER_LLM_MODEL），缺失时启动失败并给出明确提示。
2. IF LLM 调用失败或超时（默认 30s）, 系统 SHALL 返回兜底话术并自动触发升级人工流程。
3. WHEN 访客消息到达, 系统 SHALL 对输入长度做限制（默认 1000 字符）与敏感词过滤，避免越权或注入。
