# 大运河首个可玩剧本执行计划

> **For agentic workers:** 使用 `executing-plans` 按任务执行；每次完成一个可独立验收的任务。步骤使用 `- [ ]` 记录。T01—T03 已实现并验证，见 [T01 交接](../../handoffs/T01.md) 与 [T02/T03 交接](../../handoffs/T02-T03.md)；G1 只证明机制差异与费用/役负取舍，不证明平衡或史实；T04 及之后尚未执行。

**Goal:** 实现玩家直接经营运河、人间自主争用资源、按关键节点推进的完整十五年单局。

**Architecture:** 独立 TypeScript 模拟内核在 Worker 中运行，React/SVG 提供地图与祭祀界面。史料和剧本配置分离，模拟状态只由已确认事件更新；本地模板提供完整体验，可选 AI 只改写已确认事实。

**Tech Stack:** Node.js + npm、TypeScript、React/Vite、Web Worker、SVG、IndexedDB、Vitest、Playwright。核验本机为 Node v24.15.0 / npm 11.12.1；首任务验证并锁定实际依赖，记录可复现环境。

**Spec:** [需求](../../01-requirements.md)、[架构](../../02-architecture.md)、[美术规范](../../03-art-direction.md)、[模型配置](../../04-model-and-harness-guide.md)。

## 全局约束

- 玩家只操作运河工程、维护、用水、通航和时间观察；世界自主产生战争、宫殿和地方事务。
- 玩家直接决定有效方案；资源影响实施过程，不追加随机忽略神谕的判定。
- 人口、当期劳动、累计役负独立；货流自动演化；粮食、资金、水和共享运力不重复使用。
- 历史资料、模型假设、平衡参数分开；未知史料不填 0、不补造。
- 首局为 1410 年初至 1425 年初，36 旬/年，共 540 旬；该历法是游戏抽象。
- 相同版本、种子和指令产生同一模拟状态；预览、AI、绘图不得改变正式随机流。
- 无 API 仍可从开局运行到结局；密钥不进入浏览器、存档或代码仓库。
- 游戏目录为本仓库内的 `grand-canal-game/`（主工作副本：`S:/Programm/VibeCoding/The_Great_Canals_Chinesecanalsimulator/grand-canal-game`），所有下列命令均在此目录运行。相邻 atlas 只读使用；原悬疑游戏的 apps/packages 不在任务改动范围内。

## 交付顺序与模型

|关口|任务|交付|推荐执行配置|复核|
|---|---|---|---|---|
|G1 机制可推演|T01—T03|无界面的小世界，能看到河工与征役竞争|Codex Sol/high|Astra/high 检查因果与守恒|
|G2 工程产生意义|T04—T05|有水、有物流、有祈愿和关键节点|Codex Sol/high，DSH Pro/high 可替代|同种子场景比较|
|G3 完整首局|T06—T07|可操作地图、存档、首剧本和双结局|Sol/high；内容整理 DSH Flash/low|完整离线通关与小规模试玩|
|G4 体验成立|T08|统一视觉、节奏与可读性|Sol/high 实现；Terra/medium 审图|玩家理解与视觉验收|
|可选增强|T09|模型文案可插拔|DSH Flash/high 或 Sol/medium|关闭/失败模型仍可通关|

先通过 G1 再批量制作历史内容与美术。工期由每个关口的实测返工决定；文档不把模型连续运行时长当作实际研发工期。

## 共享接口与测试夹具

目标稳定导出沿用架构文档：`createGame`、`applyCommand`、`tick`、`advanceToDecision`、`preview`、`hashState`。模块实现后通过 `src/core/index.ts` 对外提供；T01 只导出已实现的 `createGame`、`tick`、`hashState` 和领域类型，不提前提供后续函数的占位实现，也不导出 UI 可随意修改的全局状态。

T01 同时建立 `tests/fixtures/scenarios.ts` 和 `tests/fixtures/inspect.ts`。以下为固定夹具名称和语义，不能靠删掉事件让测试通过：

|夹具|精确约束|
|---|---|
|minimal|起始 tick=0，endTick=540，地区 a/b，连线 ab，出资者 central；无灾害与人口自然变化；足够本期启动一项小型疏浚；种子可配置|
|peace / conscription|a 每旬劳动上限 100、生活请求 0、农业 60、正常河工 20，其他劳动请求 0；后者在 tick=3 生效、连续六旬军役请求 40。两种强制劳动役负权重相同；关闭出生、死亡和迁移，河工工作量足够九旬不完工；其他输入相同|
|palace-and-canal|a 的非农业可用劳动仅 100 单位/旬；宫殿请求 80、河工请求 80；总物理劳动上限明确，不能两边都分到 80|
|bottleneck / wider-upstream|相同供给与需求、相同闸边 60 单位/旬；上游容量分别 100/180；水源不成为瓶颈，两边旅行时间相同|
|shared-water|两个分支使用同一水源，来水/初始水量给定，无未登记外部补水；过闸下泄进入真实下游|
|crisis|含 a/b/ab 和出资者 central；effectiveTick=4 的资源撤回在 3→4 结算第一阶段生效，结算后必须暂停；后续存在持续缺粮风险；此前没有强制停点|
|legacy|国家外部战争导致终止条件，但玩家维护的局部水网仍可用，累计役负和维护债务有记录|

测试辅助接口固定为：

```ts
type FixtureName = 'minimal' | 'peace' | 'conscription' | 'palace-and-canal'
  | 'bottleneck' | 'wider-upstream' | 'shared-water' | 'crisis' | 'legacy';
function makeScenario(name: FixtureName): ScenarioDefinition;
function runTicks(state: GameState, scenario: ScenarioDefinition, count: number): GameState;
interface TestMetrics {
  populationByRegion: Record<string, number>;
  laborCapacityByRegion: Record<string, number>;
  laborAllocatedByRegion: Record<string, number>;
  burdenByRegion: Record<string, number>;
  projectWork: number;
  totalDelivered: number;
  totalWaterBalanceError: number;
  totalCargoBalanceError: number;
  futureMaintenance: number;
}
function inspect(state: GameState): TestMetrics;
```

`inspect` 只加总实际状态/账本，不重新运行经济公式；水和货的误差从期初、期末、进入、流出和消耗账目独立计算。`runTicks` 的实现如下：

```ts
export function runTicks(state: GameState, scenario: ScenarioDefinition, count: number) {
  for (let i = 0; i < count; i += 1) state = tick(state, scenario).state;
  return state;
}
```

夹具字段由类型契约表达，完整数值与设计理由写入夹具文件，分别在其相关任务中加入。minimal 在 T01 完成，其余夹具与对应机制一起完成，执行顺序不要求一次实现全部模块。

## T01：建立可复现的最小模拟

**覆盖：** FR-03/13、NFR-06。**文件：** 创建 package.json、package-lock.json、tsconfig.json、src/core/types.ts、createGame.ts、rng.ts、calendar.ts、tick.ts、index.ts、tests/fixtures/scenarios.ts、inspect.ts、tests/core/determinism.test.ts；更新 README 的环境与命令。

**Consumes：** 需求和架构，不依赖旧游戏代码。**Produces：** 完整实体类型、minimal、createGame/tick/hashState、可重复的分离随机流。

- [x] 确认目录和现有文件；在该目录初始化 npm 项目，保留设计文档；使用 `npm install --save-dev --save-exact typescript vitest tsx @types/node` 安装并锁定实际兼容版本。
- [x] 建立 strict tsconfig；package scripts 设置 `test: vitest run`、`typecheck: tsc --noEmit`；定义所有对外实体字段和单位，序列化不含函数、Map 隐式顺序或真实时间。
- [x] 建立 minimal 并写下列失败测试，再运行 `npm test -- tests/core/determinism.test.ts`。缺少函数或实现时应失败。

```ts
import { expect, test } from 'vitest';
import { createGame, hashState, tick } from '../../src/core/index';
import { makeScenario } from '../fixtures/scenarios';
test('same seed and ticks reproduce; input is not mutated', () => {
  const scenario = makeScenario('minimal');
  const first = createGame(scenario, 20261102);
  const before = hashState(first);
  const a = tick(first, scenario).state;
  const b = tick(createGame(scenario, 20261102), scenario).state;
  expect(hashState(a)).toBe(hashState(b));
  expect(hashState(first)).toBe(before);
  expect(a.tick).toBe(1);
});
```

- [x] 实现稳定序列化、起始状态和最小旬推进；随机状态属于 GameState，独立天气/人物流；加入跨年日期与 540 旬边界用例。
- [x] 运行 `npm run typecheck` 和上述测试，保存实际环境与输出摘要。检查仅修改游戏目录文件；实现者不自行提交；由集成负责人验收后提交。

## T02：指令、承诺与工程生命周期

**覆盖：** FR-01/04/06。**文件：** 创建 src/core/commands.ts、reducer.ts、projects.ts、preview.ts、invariants.ts、tests/core/projects.test.ts；修改 types.ts、tick.ts、index.ts 和 minimal。

**Consumes：** T01 状态与时间。**Produces：** applyCommand、preview、完整工程生命周期、资源承诺的锁定/消费/退回。

- [x] 用“选 ab 疏浚，central 出资，当前旬开始，小型，正常征发”建立固定指令；写下列测试。（本执行先实现后补测试，未保留首轮失败日志，见交接限制。）

```ts
import { expect, test } from 'vitest';
import { createGame, applyCommand, preview, hashState } from '../../src/core/index';
import { makeScenario } from '../fixtures/scenarios';
test('duplicate command cannot spend twice; preview is isolated', () => {
  const scenario = makeScenario('minimal');
  const state = createGame(scenario, 7);
  const command = { type: 'PLAN_PROJECT', projectKind: 'dredge',
    reachIds: ['ab'], grade: 'small', laborMode: 'normal',
    startTick: 0, sponsorIds: ['central'] } as const;
  const before = hashState(state);
  preview(state, { ...command, reachIds: ['ab'], sponsorIds: ['central'] }, scenario);
  expect(hashState(state)).toBe(before);
  const request = { commandId: 'p-1', expectedRevision: state.revision,
    command: { ...command, reachIds: ['ab'], sponsorIds: ['central'] } };
  const once = applyCommand(state, request, scenario);
  expect(once.ok).toBe(true);
  if (!once.ok) throw new Error(once.error.message);
  const twice = applyCommand(once.state, { ...request,
    expectedRevision: once.state.revision }, scenario);
  expect(twice.ok).toBe(false);
  expect(hashState(twice.state)).toBe(hashState(once.state));
});
```

- [x] 实现指令校验及 reducer。错误必须返回架构定义的 code，不能扣部分资源后再失败。
- [x] 加入暂停后恢复、取消只退未使用承诺、试航后才通航、封存保全费及退出处置的具体验收；各状态使用同一项目账本。退出处置现在以同一劳动账本和实际粮/财政支付推进，完成后责任 resolved、河段 retired。
- [x] 按架构加入“停工并处置”的 PreservationLiability；已施工后取消不能消除安全责任。SET_PASSAGE 完整支持用途时窗、限载、临时关闭与重叠时窗优先级，并测试关闭到期后恢复原日程。
- [x] 预览复制状态并输出假设区间，不读取未公开随机未来；测试预览多次后正式结果不变。
- [x] 运行 `npm test -- tests/core/projects.test.ts` 与 `npm run typecheck`；实际为 4 个测试文件 81 项通过、类型检查通过；实现者按任务边界不提交，提交留给集成负责人。

## T03：人间行动与人口/劳役竞争

**覆盖：** FR-02/05/09。**文件：** 创建 src/core/actors.ts、labor.ts、economy.ts、tests/core/labor.test.ts；修改项目结算、tick 和夹具。

**Consumes：** 项目劳动请求与资源承诺。**Produces：** 可追溯的人间行动、分地区劳动账本、役负及农业挤占。

- [x] 完成 peace/conscription/palace-and-canal 的数值夹具：相同河工，差异只有指定外部征用；关闭人口自然变化。
- [x] 写以下测试，在没有共享劳动预算时应失败。（本执行先实现后补测试，未保留首轮失败日志，见交接限制。）

```ts
import { expect, test } from 'vitest';
import { createGame } from '../../src/core/index';
import { makeScenario } from '../fixtures/scenarios';
import { inspect, runTicks } from '../fixtures/inspect';
test('conscription delays works without spending population', () => {
  const s1 = makeScenario('peace'), s2 = makeScenario('conscription');
  const a = inspect(runTicks(createGame(s1, 11), s1, 9));
  const b = inspect(runTicks(createGame(s2, 11), s2, 9));
  expect(b.populationByRegion.a).toBe(a.populationByRegion.a);
  expect(b.projectWork).toBeLessThan(a.projectWork);
  expect(b.burdenByRegion.a).toBeGreaterThan(a.burdenByRegion.a);
  expect(b.laborAllocatedByRegion.a).toBeLessThanOrEqual(b.laborCapacityByRegion.a);
});
```

- [x] 实现行动阶段、预警、实际占用与资源撤回；分配优先级显式配置，正常与加急仅改变河工请求及农业保护规则。行动在有效旬第一阶段撤回其显式链接的 revocable 承诺：未用额度退回、已用不退、hard 托管不没收。
- [x] 固定架构的分层/同层比例规则，测试扣除生活后 100 劳动、农业 60、军役 30、宫殿和正常河工各 20 时分配为 30/60/5/5；运输和维修不能在后续阶段超额取用。异地劳役到场前不记工作量。
- [x] 增加宫殿+河工无法同时取满、役负包含双方、减役后逐期恢复、资金可用但工粮未到仍停工的测试。
- [x] 用三年实际脚本核对“立即大修、延迟分段、只疏浚”；结果见 `docs/playtests/G1-mechanics.md`。等级疏浚保留不同残余淤积并改变维护劳动，大修与只疏浚各有费用/役负取舍；延迟分段无农业季节机制，被明确标为对照而非季节策略证据。
- [x] 运行 `npm test -- tests/core/labor.test.ts`、`npm run typecheck`；实际全量为 81 项通过、类型检查通过；实现者按任务边界不提交，不把工作量或哈希差异当作 G1 平衡通过。

## T04：水利网络与自动物流

**覆盖：** FR-07/08/09。**文件：** 创建 src/core/water.ts、transport.ts、tests/core/water-transport.test.ts；修改 types、tick、economy、夹具。

**Consumes：** 可用设施、季节来水、地区供需与政策。**Produces：** 水量账本、可航条件、共享容量分配、聚合在途批次及真实送达。

- [ ] 完成瓶颈和共享水源夹具；为两图建立明确连接关系，不从几何线交叉推导通航。
- [ ] 写以下结果测试；尚未限制共享资源或忽略旅行时间时应能暴露失败。

```ts
import { expect, test } from 'vitest';
import { createGame } from '../../src/core/index';
import { makeScenario } from '../fixtures/scenarios';
import { inspect, runTicks } from '../fixtures/inspect';
test('widening a non-bottleneck does not increase deliveries', () => {
  const a = makeScenario('bottleneck'), b = makeScenario('wider-upstream');
  const x = inspect(runTicks(createGame(a, 2), a, 10));
  const y = inspect(runTicks(createGame(b, 2), b, 10));
  expect(x.totalDelivered).toBeGreaterThan(0);
  expect(y.totalDelivered).toBe(x.totalDelivered);
  expect(y.totalWaterBalanceError).toBe(0);
  expect(y.totalCargoBalanceError).toBe(0);
});
```

- [ ] 实现有向水量结算和过闸实际下泄；证明两个分支不能各占全部上游供水。补充“水量只在节点间转移”和“离开边界才从全网退出”的断言。
- [ ] 实现聚合物流：自动需求、可行路线、共享边/港容量、在途进度、等待与损耗；海陆替代边使用相同接口。
- [ ] 为“发货当期不能瞬达远方”“洪水阻断只影响相关批次”“无需求没有自动运河收益”增加测试。
- [ ] 增加需求 20、旅程两旬的用例：第一旬派发 20 后第二旬不得再派 20；损耗 5 后仅有效缺口 5 可补发；拆批和取消需求均保留正确的在途占用与所有权。
- [ ] 运行 `npm test -- tests/core/water-transport.test.ts`、`npm run typecheck`；记录每个预算的单位与生效顺序，提交本任务。

## T05：关键节点与祭祀事实链

**覆盖：** FR-03/10/11。**文件：** 创建 src/core/advance.ts、petitions.ts、presentation/templates.ts、content/templates/zh-CN.json、tests/core/advance-petitions.test.ts；修改 tick、index 和夹具。

**Consumes：** 已确认事件与时期词汇。**Produces：** advanceToDecision、停点、祈愿议题聚合、本地完整文案。

- [ ] 完成 crisis：effectiveTick=4 的资源撤回在 3→4 结算生效且需要玩家响应；编写精确停点和逐旬等价测试。

```ts
import { expect, test } from 'vitest';
import { createGame, advanceToDecision, hashState } from '../../src/core/index';
import { makeScenario } from '../fixtures/scenarios';
import { runTicks } from '../fixtures/inspect';
test('skip stops at an actionable crisis and matches individual ticks', () => {
  const scenario = makeScenario('crisis');
  const initial = createGame(scenario, 23);
  const jump = advanceToDecision(initial, scenario,
    { untilTick: 100, maxTicksPerChunk: 100 });
  expect(jump.stoppedBy).toBe('decision');
  expect(jump.state.tick).toBe(4);
  const stepwise = runTicks(initial, scenario, jump.state.tick);
  expect(hashState(jump.state)).toBe(hashState(stepwise));
});
```

- [ ] 实现同根因议题合并、不同主体声音、无变化警报冷却；合并后保留每条事实来源。
- [ ] 让中央、皇室、地方、百姓、商旅各有一套模板，包括回应后反馈；事实字段由程序插入。
- [ ] 测试分块推进与不分块最终一致、玩家可提前停止、事件密集时排序稳定、没有可行动内容不强制弹窗。
- [ ] 运行 `npm test -- tests/core/advance-petitions.test.ts` 和 `npm run typecheck`；检查 G2 的流量变化能让读者说出原因，提交本任务。

## T06：可操作地图、Worker 与存档

**覆盖：** FR-01/04/13、NFR-01—05。**文件：** 创建 Vite/React 入口、src/content/devScenario.ts、src/worker/protocol.ts、simulation.worker.ts、persistence/saveCodec.ts、saveStore.ts、presentation/viewModel.ts、ui/App.tsx、MapView.tsx、ProjectPanel.tsx、PetitionPanel.tsx、Timeline.tsx、theme.css、tests/core/save.test.ts、tests/e2e/basic.spec.ts、playwright.config.ts。

**Consumes：** T01—T05 对外接口与事件。**Produces：** 单写入的 Worker UI、save encode/decode、导入导出与灰盒完整操作。

- [ ] 在独立目录安装并锁定 React/ReactDOM、Vite、对应 React 插件、类型与 Playwright；记录与本机 Node 的兼容检查。scripts 加 `dev`、`build`、`test:e2e`，后者为 `playwright test`；配置本地 webServer 和浏览器依赖。
- [ ] 把已验证的 crisis 场景构造提取到 `src/content/devScenario.ts`，导出 `createDevScenario(): ScenarioDefinition`，测试夹具也复用它。T06 的“开始新局”固定使用此场景，保证 a/b/ab 和 tick=4 停点存在；不从生产 UI 导入 tests。T07 才将正式默认开局切换为历史剧本。
- [ ] saveCodec 提供 `encodeSave(state, scenario): string`、`decodeSave(text, scenario): GameState`；先写同状态往返、坏校验摘要、未知版本和缺失队列拒绝的测试。

```ts
import { expect, test } from 'vitest';
import { createGame, tick, hashState } from '../../src/core/index';
import { encodeSave, decodeSave } from '../../src/persistence/saveCodec';
import { makeScenario } from '../fixtures/scenarios';
import { runTicks } from '../fixtures/inspect';
test('save round trip preserves the next simulation outcome', () => {
  const scenario = makeScenario('crisis');
  const live = runTicks(createGame(scenario, 5), scenario, 3);
  const loaded = decodeSave(encodeSave(live, scenario), scenario);
  expect(hashState(tick(loaded, scenario).state))
    .toBe(hashState(tick(live, scenario).state));
});
```

- [ ] 实现 Worker 请求版本校验、进度和旬边界中止，UI 只保存草稿与选择；做一个拖动地图、选 ab、比较并提交工程的流程。
- [ ] 先编写下列浏览器流程，再使其通过；各按钮使用对应可访问名称，地图同时有河段列表替代入口。

```ts
import { test, expect } from '@playwright/test';
test('a local game can advance and save without an AI service', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '开始新局' }).click();
  await page.getByRole('button', { name: '推进到关键节点' }).click();
  await expect(page.getByTestId('decision-reason')).toBeVisible();
  await page.getByRole('button', { name: '保存游戏' }).click();
  await expect(page.getByRole('status')).toContainText('保存成功');
});
```

- [ ] 实现 IndexedDB 错误反馈、导出、旧版拒绝和自动保存；增加存储失败不能显示成功、过期 Worker 结果不能覆盖新局的验收。
- [ ] 验证自动档位于事件结算后/下一指令前，读档不撤销已发生灾害；在途占用、保全责任和通航日程经存取后保持一致。
- [ ] 运行 `npm test -- tests/core/save.test.ts`、`npm run typecheck`、`npm run build`、`npm run test:e2e -- tests/e2e/basic.spec.ts`；人工检查暂停和恢复，提交本任务。

## T07：首个历史剧本、双结局与平衡实验

**覆盖：** FR-09/11/12、NFR-06。**文件：** 创建 content/evidence、content/scenarios/ming-1410.json、src/content/schema.ts、loadScenario.ts、core/endings.ts、ui/EndingPanel.tsx、scripts/importAtlas.ts、runBalance.ts、tests/content/scenario.test.ts、tests/core/endings.test.ts、docs/playtests/G3-balance.md。

**Consumes：** 现有 atlas 的来源和示意线路、完整模拟、模板。**Produces：** 经过校验的十五年剧本、世界/河道遗产结果与实验报告。

- [ ] 选择约十个抽象区域与二十条候选/在用河段，记录准确实体 ID、来源、可航时期、连接和所采用的游戏假设；精度不足处显式标注。
- [ ] 内容 schema 拒绝重复 ID、失效引用、负容量、错误时间区间、缺少来源类型或未声明单位；导入脚本只写 content，不改 atlas。
- [ ] 写双结局测试，并为 legacy 固定一条外部战争来源链。

```ts
import { expect, test } from 'vitest';
import { createGame } from '../../src/core/index';
import { makeScenario } from '../fixtures/scenarios';
import { inspect, runTicks } from '../fixtures/inspect';
test('world failure retains useful canal legacy and external causes', () => {
  const scenario = makeScenario('legacy');
  const state = runTicks(createGame(scenario, 19), scenario, scenario.endTick);
  expect(state.ending?.world.outcome).toBe('collapse');
  expect(state.ending?.legacy.usableReachCount).toBeGreaterThan(0);
  expect(state.ending?.externalCauseIds.length).toBeGreaterThan(0);
  expect(inspect(state).futureMaintenance).toBeGreaterThan(0);
});
```

- [ ] 实现正常结束、持续危机条件、预警响应机会、全局累计/末期统计及维护责任；结局引用事件而不是生成未经验证的因果。
- [ ] `runBalance.ts` 实现四种确定性策略：维护优先、瓶颈优先、扩张优先、低征役优先；至少比较 30 个共同种子及旱、洪、征兵、宫殿条件，输出 CSV/JSON。scripts 加 `balance: tsx scripts/runBalance.ts`。
- [ ] 检查是否出现无限获利、负库存、免费退出、最后一期停修刷分，以及总能支配其他方案的路线。记录现象、改动参数版本、复测差异；不用“所有策略都赢”作目标。
- [ ] 运行 `npm test -- tests/content/scenario.test.ts tests/core/endings.test.ts`、`npm run balance`、`npm run build`，离线完成一局；通过 G3 后提交。

## T08：美术、信息层次与真实试玩

**覆盖：** NFR-03/04、全部玩家反馈。**文件：** 创建 assets/manifest.json、assets 地图/图标/插图、docs/playtests/G4-playtest.md；修改 ui 和 theme.css；建立 tests/e2e/readability.spec.ts。

**Consumes：** 完整首局、[美术规范](../../03-art-direction.md)。**Produces：** 统一风格界面、可读的多状态资产和带证据的试玩修改。

- [ ] 先制作主地图、工程比较、祭祀三张样张；使用真实长短文案、未知值、工期区间及危险状态。
- [ ] 检查纸底、线型、对比、地理与仪式年代；通过后按规范的小批量清单制作，其余资产保持占位几何但不冒充完成品。
- [ ] 在 1280×720 和 1440×900、150% 字体与减少动效设置下走通全部核心动作，记录实际截图。下列测试只是自动检查的入口，最终仍需人工看图。

```ts
import { test, expect } from '@playwright/test';
test('small viewport can open an engineering plan', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await page.getByRole('button', { name: '开始新局' }).click();
  await page.getByRole('button', { name: '河段列表' }).click();
  await page.getByRole('button', { name: /^查看河段：/ }).first().click();
  await expect(page.getByRole('button', { name: '比较工程方案' })).toBeVisible();
});
```

- [ ] 首轮邀请 3—5 名未读设计的测试者：记录第一次有效决策耗时、瓶颈/劳役理解、空等次数、是否能解释一次结果、局长及最常选路线。人数是首轮诊断规模，不用于声称统计显著。
- [ ] 用浏览器性能记录测量 NFR-03，报告机器、浏览器、数据规模和 P95；慢在哪里就修改哪里，不凭感觉升级渲染引擎。
- [ ] 运行 `npm run test:e2e -- tests/e2e/readability.spec.ts`、`npm run build`；补齐资产来源与许可，保存试玩报告和改动，提交 G4。

## T09：可选模型文案

**覆盖：** NFR-01/05、FR-10/11。**依赖：** G3 通过；不阻塞 G4。**文件：** 创建 src/presentation/narration.ts、server/narration.ts、tests/presentation/narration.test.ts；按需要加入服务端脚本和依赖。

**Consumes：** 已确认事件、事实 ID、时期词汇、主体立场。**Produces：** 可关闭、可超时回退、无状态写权限的文案适配器。

- [ ] 定义接口：`NarrativeProvider.generate(input: NarrativeInput): Promise<NarrativeOutput>`；输入含 eventIds、facts、voice、period；输出含 text、eventIds、voice。导出无必需构造参数的 `NarrationService` 类，其 `render(input, provider?)` 返回 `{text, source: 'template' | 'model'}`。
- [ ] 写模型失败仍有文案且模拟不变的测试，先确认失败。

```ts
import { expect, test } from 'vitest';
import { createGame, hashState } from '../../src/core/index';
import { NarrationService } from '../../src/presentation/narration';
import { makeScenario } from '../fixtures/scenarios';
test('provider failure falls back without affecting simulation', async () => {
  const narration = new NarrationService();
  const scenario = makeScenario('minimal');
  const state = createGame(scenario, 8), before = hashState(state);
  const input = { eventIds: ['event-1'], facts: [{ id: 'fact-1', text: '河段维修完成' }],
    voice: 'local', period: '明初' };
  const output = await narration.render(input, {
    generate: async () => { throw new Error('timeout'); }
  });
  expect(output.source).toBe('template');
  expect(output.text.length).toBeGreaterThan(0);
  expect(hashState(state)).toBe(before);
});
```

- [ ] 实现服务端密钥、超时、取消、摘要缓存、纯文本输出和事实校验；过期事件版本不替换新文案。模型不持有任何模拟写入入口。
- [ ] 以 deepseek-flash/off 起步，对比 low 的祈愿质量；完整剧本分别开/关 AI 跑同种子，模拟哈希必须一致。只在已有授权与凭据可用的实际接入阶段运行付费评测。
- [ ] 运行 `npm test -- tests/presentation/narration.test.ts`、`npm run build` 和离线回归；记录成本/延迟/回退率，只有体验收益明确才默认开启。

## 完成标准与交接

G4 通过表示首个可玩版本成立，不表示历代全地图、全部水工史或商业发行已经完成。T09 为可选增强。

每个任务交接包含：基线提交/工作状态、修改文件、需求 ID、接口变化、已执行命令及结果、可复现缺陷、参数/史料变动与下一步。不要只交一段“已完成”的聊天。

|需求|实现任务|
|---|---|
|FR-01|T02、T06|
|FR-02|T03|
|FR-03|T01、T05、T06|
|FR-04|T02、T06|
|FR-05|T03|
|FR-06|T02、T06|
|FR-07|T04|
|FR-08|T04、T06|
|FR-09|T03、T04、T07|
|FR-10|T05、T08；T09 可选|
|FR-11|T05、T07、T08；T09 可选|
|FR-12|T07|
|FR-13|T01、T06|
|NFR-01|T05、T06、T09|
|NFR-02|T06|
|NFR-03|T06、T08|
|NFR-04|T06、T08|
|NFR-05|T06、T09|
|NFR-06|T01、T07、T08|

在开始实际开发时，先执行 T01—T03 并取得 G1 的日志和纸面推演结果，再评估后续任务。不要用提前制作大量插图或联网角色替代对核心选择的验证。

## v0.2 追加执行范围

T01—T09 保留为基础单局计划；[长剧本 C01—C05](../../05-sui-tang-campaign.md)接续实现多政权与传承，覆盖 FR-14、FR-15、FR-16、FR-17、FR-18、FR-19。按[Agent 执行合同](../../06-agent-execution-contract.md)分派所有者。共享日历和结束条件必须参数化，不能把明初夹具数值硬编码为全游戏规则。
