# Codex 与 DeepSeek Harness 使用指南

核验日期：2026-11-02（Asia/Shanghai）。用途：开发本游戏及可选文案服务。以下任务分配是项目建议，未做本项目模型对照评测；模型列表、价格和档位会变，应在开工或升级时重新核对。

## 1. 已核实的环境与官方信息

本机 Codex 模型缓存列出了 `gpt-6.1-sol`、`gpt-6-astra`、`gpt-6.1-terra`、`gpt-6-luna` 等模型。当前全局文件设置为 `gpt-6-astra` / `max`；这不保证每个已有聊天都使用全局值。本机 DSH 的 Web 配置中保存了 `deepseek-flash` / `low`。本次仅查看模型相关字段，没有修改设置，也没有读取凭据内容。

OpenAI 官方当前将 Sol 用于长期、多步骤工作，Astra 用于难度最高的工作，Terra 用于写作和视觉理解，Luna 用于范围清楚的重复任务。桌面端和 API 的默认思考档位可能不同；应明确选择本项目所需档位。[官方模型说明](https://learn.chatgpt.com/docs/models)

DeepSeek 官方当前 API ID 为 `deepseek-flash` 与 `deepseek-v4-pro`。核验时对应版本分别为 DeepSeek-V4.1-Flash-1017、DeepSeek-V4-Pro-0813；`deepseek-v4-flash` 等旧名仍可能被转接，新增配置采用当前 ID。[官方模型表](https://api-docs.deepseek.com/quick_start/pricing/)

## 2. 推荐的开发分工

|任务|Codex 建议|DeepSeek Harness 建议|交付和升档条件|
|---|---|---|---|
|日常功能开发，边界明确|GPT-6.1 Sol / medium；核心多文件任务 high|deepseek-flash / high|一次完成一个可验收任务；先修上下文和测试，再考虑升档|
|模拟内核、资源守恒、存档和时间模型|GPT-6.1 Sol / high|deepseek-v4-pro / high，作为替代或交叉检查|若出现跨模块矛盾或难复现问题，升级到下行|
|架构争议、长期因果、顽固缺陷|GPT-6 Astra / high，仍困难时 xhigh|deepseek-v4-pro / max，仅用于明确难题|给最小复现、失败日志和两个候选解释；不能只要求“再想想”|
|JSON 剧本、字段转换、有限文案批处理|GPT-6 Luna / high；很简单的转换可 low|deepseek-flash / low|机器校验每条 ID、来源、单位和时期；不让模型补造史实|
|前端组件和地图交互|GPT-6.1 Sol / high|deepseek-flash / high|以可运行页面、真实状态与交互验证为交付|
|截图与美术可读性审查|GPT-6.1 Terra / medium；复杂 UI 比较 high|deepseek-flash / low 或 high|附目标图、实际截图、分辨率和明确检查项|
|关键改动独立复核|GPT-6 Astra / high|deepseek-v4-pro / high|复核守恒、事件时序和边界，提供可复现问题|
|小型文档修订与格式整理|GPT-6.1 Terra / low 或 medium|deepseek-flash / low / off|字段、链接及术语检查通过即可|

优先采用“一个主执行者 + 有明确输入的复核”。Codex 和 DSH 可顺序接力同一 checkout；同时工作时必须隔离文件或使用独立工作树，不能同时修改同一状态类型、锁文件或剧本。

若只选一套长期默认：**Codex 选 GPT-6.1 Sol / high；DSH 选 deepseek-flash / high。** 对范围小的任务主动降档。Astra 和 Pro/Max 用于通过更清楚的复现仍未解决的难题。此选择是开始实验的基线，不代表已证明哪家编码准确率最高。

## 3. 思考程度怎样选择

Codex 的 low/medium/high/xhigh/max 是对应模型支持的思考设置。Ultra 还涉及自动分工，不仅是单模型多想一会儿；多数任务不需要 Max 或 Ultra。当前产品文档说明与本机模型缓存均应核对，不能把 API 支持范围无条件等同于客户端菜单。[官方模型与档位](https://learn.chatgpt.com/docs/models)

本项目建议先提供需求 ID、准确文件、接口、失败案例与验收，再升档。官方也建议只有评测显示收益时才为 xhigh 付出更多等待与用量。[推理配置说明](https://developers.openai.com/api/docs/guides/reasoning)

DeepSeek 的直接接入路径使用 `off / low / high / max`。API 中 medium、xhigh 会映射为 high，ultra 映射为 max；不要把 Codex 的名称机械复制过去。Chat Completions 使用 `thinking` 开关与 `reasoning_effort`，Responses 使用 `reasoning.effort`，两种请求结构不能混写。[DeepSeek 思考模式](https://api-docs.deepseek.com/guides/thinking_mode/)

没有给所有工作预设 max：先测每个验收任务的首次通过率、完成用时、返工量和实际费用。连续失败先检查信息缺失、环境和接口，再改模型。

## 4. Codex 设置建议

在桌面聊天输入框附近的模型/思考设置中选择模型和档位；支持的 CLI 可用 `/model` 调整。以下 TOML 是配置示例，不是本次已应用的改动：

```toml
model = "gpt-6.1-sol"
model_reasoning_effort = "high"
```

在全局配置中改变会影响默认值，按任务切换更适合初期对比。保留其他 provider、权限和项目配置；不要覆盖整份文件。字段以[官方配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)为准。可用模型以当前客户端和账户实际列出的项目为准。

针对本机当前 Astra/max，建议日常执行显式切换为 Sol/high 或 Sol/medium，保留 Astra 用于关键架构和复核。此建议没有自动修改用户偏好。

## 5. DeepSeek Harness 设置建议

这里指 DeepSeek 官方的开源 `deepseek-ai/deepseek-harness`（dsh），不是把现有游戏里的 harnessTurn 路由改名。官方仓库仍标为 developer preview；实施时记录使用版本，以对应版本文档为准。[官方仓库](https://github.com/deepseek-ai/deepseek-harness)

推荐在 Web UI 的 Settings → Models 配置官方 DeepSeek 路径，再从模型选择器选择 `deepseek-flash` 或 `deepseek-v4-pro`，在 Effort 菜单选 low/high/max/off。优先使用 UI，保留当前的账户或 API-key 接入方式。默认 Web profile 的高级配置位于 `$DSH_HOME/profiles/web/cordis.patch.yml`，其他 profile 使用自己的目录。[官方配置指南](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/providers.md)

直接 DeepSeek 适配器的默认档位示例：

```yaml
- id: llm-deepseek
  config:
    reasoningEffort: high
```

该片段仅解释字段。若已有同 ID 配置，应在原项内修改；Cordis 配置覆盖可能替换完整条目，不能粘贴片段覆盖其他配置。会话已记录的选择可能优先于默认值，需在当前模型菜单核对。

自定义网关若显示“off”却仍思考，需要检查网关协议及 `compat.thinkingFormat: deepseek` 等实际适配设置；不要凭菜单名称推断已生效。直接官方路径通常无需另装思考滑块插件。配置细节以当前 Harness 的[官方适配器文档](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/llm/llm-deepseek)核对。

## 6. 开发工具与游戏运行时的区别

开发时的 Codex/DSH 负责编辑代码、运行检查、整理资料和审图。游戏运行时由确定性模拟产生世界变化，不需要启动编码 Harness 或在每旬调用模型。

|游戏内用途|初始方案|理由和边界|
|---|---|---|
|所有正式数值、历史事件条件、物流、结局|本地规则与模板|确保可复现和离线完整|
|祈愿语气变化、已确认事件短文|可选 deepseek-flash / off|低延迟起步；若表达质量不足再比较 low|
|较长阶段复盘|可选 deepseek-flash / low|输入只含确认事件与允许展示的事实|
|史料解读与争议整理|开发时用 Astra/high 或 Pro/high|必须带来源，人工审阅后才能入内容库|

在线文案不是首局必需品。先测模板体验，再比较启用模型是否增加可理解性。避免每旬全地区多 Agent 调用造成延迟与费用膨胀。

API 请求形状示例，属于后续服务端实现说明：

```json
{
  "model": "deepseek-flash",
  "messages": [{"role": "user", "content": "根据给定事实改写短祈愿"}],
  "thinking": {"type": "disabled"},
  "max_tokens": 800
}
```

若使用 OpenAI Python SDK，DeepSeek 的扩展 `thinking` 字段按官方示例通过 `extra_body` 传递；不要照抄为所有 SDK 都接受的顶层命名参数。800 是本项目输出预算示例，不是服务商限制。工具调用兼容性和 reasoning_content 的保存规则只在实际启用对应协议时遵守；首版文案服务不提供工具调用。[思考与工具调用文档](https://api-docs.deepseek.com/guides/thinking_mode/)

当前 `deepseek-flash` 支持图片输入，`deepseek-v4-pro` 的官方模型表未提供视觉输入；因此截图审查用 Flash 或 Codex 的视觉模型，不能默认 Pro 能看图。两者都不是美术图像生成接口。[DeepSeek 视觉指南](https://api-docs.deepseek.com/guides/vision/) · [模型能力表](https://api-docs.deepseek.com/quick_start/pricing/)

## 7. 成本与模型验证

不用固定“每天花多少钱”作为承诺。一次任务成本取决于输入、缓存、输出/思考量、工具轮数与返工；订阅额度和 API 计费也不同。

在第一批四类任务上比较：劳动守恒、跳时中断、地图面板、结构化事件文案。每类准备三个明确验收任务，同一仓库快照、同一说明、固定检查。记录模型 ID、档位、版本/返回元数据、总耗时、通过率、人工修正和实际用量，比较至少十二个任务后再确定默认。

DeepSeek 可通过账户可用模型列表核实 ID、输入能力和 effort 元数据；上线时记录实际返回模型及日期，不能只存可变别名。[官方模型发现接口](https://api-docs.deepseek.com/api/list-models/)

费用记录用调用返回的 usage 与当日官方单价计算，并单独记录订阅消耗；没有有效缓存计费数据时不估算成已命中缓存。查看[DeepSeek 当日价格](https://api-docs.deepseek.com/quick_start/pricing/)及 OpenAI 对应计费页面后再做预算。

## 8. 可复制的任务交接

### 主执行者任务单

```text
项目：grand-canal-game。
先读 README.md、docs/01-requirements.md、docs/02-architecture.md。
本次只执行 docs/superpowers/plans/2026-11-02-grand-canal-mvp.md 中的一个任务。
说明该任务覆盖的需求 ID、允许改动的文件、依赖的接口与验收命令。
保留玩家只控制运河、物流自动演化、世界自主争用资源的边界。
历史数据缺失保持未知；模型参数明确标为游戏抽象。
先复现验收失败，再实现到检查通过；对文档/纯视觉调整使用相应检查。
完成后报告实际改动、已运行检查、失败原因和交接所需信息。
不得为了让测试通过修改需求语义、伪造命令成功或移除关键约束。
```

### 独立复核任务单

```text
读取需求、架构、被交付任务和差异；先不修改文件。
重点检查资源是否重复花费、跳时是否漏掉危机、预览是否改正式状态、
人口是否被错误当作劳力货币、AI/界面是否能直接改模拟结果。
给出可复现输入、实际结果、预期结果、影响范围和修复位置。
没有证据的问题标为待实验假设，不能当作已确认缺陷。
```

### 美术/前端任务单

```text
读取 docs/03-art-direction.md，使用指定剧本与真实中文样例。
本次交付主地图、工程卡或祭祀页中的一个完整状态流程。
至少展示正常、资源不足、施工暂停和风险状态。
保持地理线、文字、业务状态与插图分层。
提供 1280×720 与 1440×900 的实际页面截图，说明键盘和减少动效表现。
```

## 9. 何时重新核对

新增模型、切换账户/网关、Harness 升级、官方模型别名迁移、图像能力变化或成本明显变化时，重新查官方文档并记录配置。不能把本指南的日期抹掉后继续称为最新配置。
