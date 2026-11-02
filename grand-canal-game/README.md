# 大运河游戏 · 设计与实施文档

版本：v0.1　日期：2026-11-02（Asia/Shanghai）　状态：玩法方向已确认，以下为首版开发基线。

玩家化为能决定运河命运的“天意”。中央、皇室、地方、百姓和商旅通过祭祀表达诉求；玩家直接安排运河工程与经营，人间事务自主变化并影响工程可用资源及其社会后果。

本目录包含游戏设计文档和 T01—T04 模拟内核。现已建立类型、开局校验、分离随机流、稳定哈希、简化日历与最小原子旬推进；并加入有类型指令、隔离预览、工程生命周期、资源托管/退回、通航日程/关闭期、分层劳动分配与役负、付费安全退出、等级疏浚实效和行动撤回可撤回承诺；T04 加入独立有向水量账本（入流/蒸散/灌溉/过闸泄水/溢流守恒）与自动物流（自动需求、稳定路线、共享边/节点容量、旅行旬推进、损耗、限载拆批、取消转回、运输/维护劳动与财政），以及默认为空的可配置期间消费/补库规则（按目的地真实缺口与在途占用生成稳定需求，送达后才消费并计入货物账本）。尚无可玩界面、人口/价格驱动的消费、天气、灾害、祈愿或结局评价；G1 只证明机制差异可观测，不证明平衡或史实。历史资料沿用相邻的 `grand-canal-atlas`。

## T01—T04 环境与命令

在本仓库的 `grand-canal-game` 目录运行。固定环境为 Node.js **24.15.0**、npm **11.12.1**（见 `.node-version`、`packageManager`、`engines`）；`.npmrc` 开启精确依赖与环境校验。开发依赖锁定 TypeScript 7.0.2、Vitest 5.0.5、tsx 4.23.15、@types/node 24.19.2，传递依赖见 `package-lock.json`。

```powershell
cd grand-canal-game
npm ci
npm run typecheck
npm test
# 本机沙箱若禁止 Vitest forks 子进程（spawn EPERM），改用线程池：
npm test -- --pool=threads
# 只运行 G1 相关验收：
npm test -- tests/core/projects.test.ts tests/core/labor.test.ts --pool=threads
# 三年三方案测量（普通 shell；本机沙箱用 Node 类型剥离运行了同一脚本）：
npx tsx scripts/runG1.ts
# 沙箱禁止 esbuild 子进程时：
node --experimental-strip-types --loader ./scripts/ts-resolve-loader.mjs scripts/runG1.ts
```

公共函数为 `createGame(scenario, seed)`、`applyCommand(state, envelope, scenario)`、`preview(state, command, scenario)`、`tick(state, scenario)` 和 `hashState(state)`；输入及返回快照不共享可变数据。开局拒绝非整数/非 JSON 数据、未知或缺失字段、重复 ID、失效实体引用及非法范围；`parameters` 单独保存全部游戏系数与单位。单位均为游戏抽象，未填充历史数值。

`applyCommand` 先检查 revision，再查重复 ID、目标、时间、阶段和资源承诺；成功后只经 `reduceEvent` 提交并增加一次 revision，失败保留原哈希、随机流和待处理队列。支持计划/疏浚/扩建/改道、暂停/恢复/取消、维护政策、通航日程与关闭、用水政策和河段状态。工程资金由出资者托管；未花额度按原出资者退回，已施工取消保留工作并建立保全责任，责任通过同一劳动账本、实际工地粮和财政支付的安全退出解除后河段才退休；改道链接旧道处置。行动可在有效旬第一阶段撤回其显式链接的可撤回承诺：未用额度退回、已用不退、hard 托管不没收。通航日程每用途独立，空数组表示该用途全年不通行；临时关闭为半开区间，到期恢复原日程；限载等级只限制资格。

`preview` 在副本/只读计算中给出可行性、确定投入、工作量和工期区间、工地粮/物料需求、竞争行动与未知项；不消耗正式随机流，也不读取未公开未来。`tick` 按旬结算行动阶段、分层劳动、工程进度、农业、库存、役负与账本，仍只通过一个 `TICK_COMPLETED` 事件进入唯一归约器。疏浚按工程等级移除不同比例的当前淤积；残余淤积进入维护劳动请求，维护请求与退出劳动同受分层配额约束。

劳动按 0 生活、1 军役/抢险/加急河工、2 农业保护、3 维护/安全退出/运输、4 宫殿/地方/正常河工/额外养护分层；同层按“有效请求 × 权重”水填充分配，整数余数按最大余数和 `activityId`。征役不扣人口；异地劳役延期到场；工地无粮即停工；役负按实际强制劳动累计并逐期恢复。运输与维护劳动估算并入同一共享预算，实际移动不超过已分配劳动；维护财政真实支付，钱不足降低维护而非免费收益。可选的 `parameters.supply.rules` 在每旬运输前按目的地库存和已预留的在途货量生成/更新稳定需求，运输到达后才按真实库存消费，消费量进入货物账本；规则默认空，旧夹具不产生新需求或消费。`peace`/`conscription`/`palace-and-canal` 夹具只使用合成数值；`bottleneck`/`wider-upstream`/`shared-water` 夹具已完成，`crisis`/`legacy` 夹具留待后续任务。

实际检查、文件所有权、接口变更和限制见 [T02/T03 交接](docs/handoffs/T02-T03.md)；三年三方案实测与环境/维护取舍见 [G1 记录](docs/playtests/G1-mechanics.md)。G1 记录不把工作量、哈希或更多支出当作设施收益，也不声称平衡成立。当前没有 `dev`、`build` 或浏览器端流程。

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

## 第一阶段进度

T01—T04 已完成：可重复状态、时间、有类型指令、工程生命周期、劳役竞争模型，以及有向水量账本、自动物流与可配置消费/补库规则（FR-07/08/09），并用小型合成场景做了三年三方案推演（G1）。下一步加入关键节点停点与祭祀（T05），再做地图操作和祭祀界面；基本玩法完整后再接入可选 AI 文案。G1 记录只证明机制差异可见，不证明平衡、史实或可玩性。

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
- 初版交付仅为文档；后续构建与验收要求仍按任务逐项实现。T01—T03 的实际实现与检查见上方命令及交接记录，不代表整款游戏已实现。

## v0.2 新增内容

- [隋前至唐末五代十国长剧本](docs/05-sui-tang-campaign.md)：550—980 观察窗口，六章独立或连续继承。
- [Agent 执行合同](docs/06-agent-execution-contract.md)：八个角色的模型、档位、文件所有权与验收。
- 仓库级规则见 [AGENTS.md](../AGENTS.md)。

此 GitHub 仓库是后续开发的主工作副本。旧 murder-loop-ai 目录中的文档为初版快照；执行时以本仓库为准。
