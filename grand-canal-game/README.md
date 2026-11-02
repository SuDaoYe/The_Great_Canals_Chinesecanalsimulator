# 大运河游戏 · 设计与实施文档

版本：v0.1　日期：2026-11-02（Asia/Shanghai）　状态：玩法方向已确认，以下为首版开发基线。

玩家化为能决定运河命运的“天意”。中央、皇室、地方、百姓和商旅通过祭祀表达诉求；玩家直接安排运河工程与经营，人间事务自主变化并影响工程可用资源及其社会后果。

本目录是新游戏的文档包。历史资料沿用相邻的 `grand-canal-atlas`，游戏源代码尚未建立。Markdown 是本次交付格式，便于 Git 管理和直接交给 Codex / DeepSeek Harness 执行。

|文档|读者与用途|
|---|---|
|[需求文档](docs/01-requirements.md)|确定玩家权限、核心循环、资源、事件、结束条件与验收标准|
|[架构设计](docs/02-architecture.md)|确定模拟内核、双网络、时间推进、存档、数据与可选 AI 边界|
|[美术与交互规范](docs/03-art-direction.md)|确定地图、祭祀、工程界面、资产规格与视觉验收|
|[Codex / DeepSeek Harness 使用指南](docs/04-model-and-harness-guide.md)|选择模型、思考档位、任务分工、配置方式及交接模板|
|[具体执行计划](docs/superpowers/plans/2026-11-02-grand-canal-mvp.md)|按可验收任务开发第一局，包含文件、接口、检查命令与里程碑|

## 约束的解释顺序

1. 需求中标为“已确认”的决定是产品约束。
2. “开发基线”是为消除实施歧义选定的首版方案，可以通过明确变更记录调整。
3. “实验参数”用于制作和试玩，不是已测得的历史数据或性能结果。
4. 资料有史实依据，不表示模拟系数已被历史验证；史料值、模型假设、平衡参数分别保存。

## 第一阶段建议

先完成执行计划的 T01—T03：可重复运行的状态、时间与劳役竞争模型，并做一次小型纸面推演。之后加入水利物流、地图操作和祭祀界面；基本玩法完整后再接入可选 AI 文案。

日常开发建议起步配置为 **Codex / GPT-6.1 Sol / high**，明确的小任务使用 medium；架构难题和关键复核用 **GPT-6 Astra / high**，需要时再升 xhigh。DeepSeek Harness 的常规实现与批处理从 **deepseek-flash / high** 起步，复杂任务比较 **deepseek-v4-pro / high**。这些是本项目建议，非已完成的模型性能测试；准确设置与官方依据见使用指南。

## 现有资料

- [历史地图和资料说明](../grand-canal-atlas/README.md)
- [地图精度与时期限制](../grand-canal-atlas/wiki/03-geography-and-map-method.md)
- [史料核对与争议](../grand-canal-atlas/wiki/02-verification-and-disputes.md)
- [工程与机制研究](../grand-canal-atlas/wiki/05-game-design-hypotheses.md)

## 文档完成检查

详细过程见[文档验证记录](docs/review-notes.md)。

- 已确认玩法与实施基线分开表述。
- 所有玩家输入都属于运河工程、维护、用水、通航或时间观察。
- 需求 ID 在架构和执行计划中建立对应关系。
- 模型与 Harness 配置按 2026-11-02 官方资料核对；未修改用户的模型设置，未调用付费模型接口做评测。
- 本次仅交付文档；文中的构建命令和测试是后续开发要求，不表示游戏已实现或测试已通过。

## v0.2 新增内容

- [隋前至唐末五代十国长剧本](docs/05-sui-tang-campaign.md)：550—980 观察窗口，六章独立或连续继承。
- [Agent 执行合同](docs/06-agent-execution-contract.md)：八个角色的模型、档位、文件所有权与验收。
- 仓库级规则见 [AGENTS.md](../AGENTS.md)。

此 GitHub 仓库是后续开发的主工作副本。旧 murder-loop-ai 目录中的文档为初版快照；执行时以本仓库为准。
