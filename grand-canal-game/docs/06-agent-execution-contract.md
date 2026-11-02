# 多 Agent 执行合同

版本 v0.2，2026-11-02。本文是可直接交给开发 Agent 的分工规则，不表示已经启动所有 Agent。模型与档位依据见[模型指南](04-model-and-harness-guide.md)。

## 角色与写入边界

|Agent|固定起步配置|负责任务|允许写入|禁止直接修改|
|---|---|---|---|---|
|A 集成与架构|Codex GPT-6 Astra / high；难题才 xhigh|接口冻结、任务分发、集成、C01/C02 审核|core/types.ts、core/index.ts、core/tick.ts、core/reducer.ts、worker/protocol.ts、package/锁文件、总架构|不替代历史证据审查|
|B 工程与劳动|Codex GPT-6.1 Sol / high|T02/T03、继承后的工程责任|core/commands.ts、projects.ts、actors.ts、labor.ts、economy.ts、preview.ts、对应 tests/core 文件|共享类型/总调度、地图 UI|
|C 水利与物流|DeepSeek Harness deepseek-v4-pro / high；守恒难题 max|T04、跨境运输部分 C02|core/water.ts、transport.ts、对应测试|国家资源总账、共享类型、史料原文|
|D 前端与存档|Codex GPT-6.1 Sol / high|T06、T08 界面、跨章选择/存档|ui、presentation/viewModel.ts、worker/simulation.worker.ts、persistence、tests/e2e|core 模拟规则、worker/protocol.ts|
|E 历史与剧本|DeepSeek Harness deepseek-flash / high；机械整理 low|T07 内容、C03/C04|content/evidence、content/scenarios、content/templates、scripts/importAtlas.ts、考据记录|模拟系数的未审查变更、核心引擎|
|F 视觉规范与审图|Codex GPT-6.1 Terra / medium；复杂比较 high|T08 视觉验收、分时期资产规范|assets、assets/manifest.json、美术文档、视觉验收记录|ui/theme.css 由 D 合并，不能修改业务状态|
|G 独立质量审查|Codex GPT-6 Astra / high|各任务验收与 G1—G4/C05 复核|审阅报告、经 A 分配的独立回归测试|默认只读实现；不与作者同时修同一文件|
|H 可选叙事接入|DeepSeek Harness deepseek-flash / high|T05 模板投影、T09 服务|presentation/templates.ts、narration.ts、server/narration.ts、tests/presentation|content/templates 由 E 所有，所有模拟写入口|

F 是视觉理解与规范角色，不是图像生成模型。真正的插图生成使用专门图像工具，经 F 人工/模型辅助审查后入库；Pro 不作为截图输入模型。模板文字由 E 提供，H 负责渲染适配；样式由 F 提议、D 落地。

T01 由 A 完成最小契约、随机和时间，再把稳定接口交给 B/C。A 拥有配置文件不代表擅自改用户全局 Codex/DSH 设置。默认每个开发工具只有一个写入任务；多个会话并行必须使用隔离工作树。

## 调度与升级

1. A 先冻结本轮接口与夹具，标明基线 commit 和依赖版本。
2. B 完成 T02/T03 后 G 检查 G1；C 可在稳定接口下独立写水利物流；D 可用同版本静态 ViewModel 做灰盒，不编造引擎结果。
3. E 整理来源、F 制作样张可并行；共享 JSON schema 的修改先交 A 决定。
4. A 合并 C，再接 T05 和 D 的完整操作；G 验证 G2/G3。H 的模型文案在离线完整局之后接入。
5. 长战役先 C01/C02；B 负责工程/劳动继承，C 负责边界和在途，D 负责存档/选择，E 负责隋章，A 统一提交状态转换接口。
6. 只有 C03 小切片通过才发出六章批量内容任务；C05 由 G 独立验证。

遇到问题先提供最小复现和已尝试结果，再升档。Sol/high 连续两次无法解释的跨模块问题交 A/Astra；Pro/high 的守恒难题可升 max，但必须保留反例。历史争议由 E 提交来源给 A/G，不因更强模型的自信而变成事实。

## 任务单格式

```text
TASK-ID: T04-water-shared-budget
Owner: C / DeepSeek Harness / deepseek-v4-pro / high
Base commit: 由 A 填入本轮真实 SHA，缺失时先读取 git HEAD 并确认依赖已合并
Read: AGENTS.md、需求 FR-07/08、架构第7节、T04
Write: src/core/water.ts、src/core/transport.ts、tests/core/water-transport.test.ts
Inputs: 已冻结 GameState/ScenarioDefinition、共享水源与瓶颈夹具
Outputs: 实际水量账本、共享运力、在途占用；不增加玩家货物操作
Acceptance: 同水源分支不重复耗用；过闸下泄守恒；两旬运输不重复派发；非瓶颈加宽不增送达
Run: npm test -- tests/core/water-transport.test.ts；npm run typecheck
Handoff: 实际 SHA、改动文件、测试输出摘要、剩余问题、接口变更请求
```

所有代码路径相对于 grand-canal-game。运行前检查任务阶段：源码未建时按 T01 初始化，不能把不存在的测试写成已通过。无法使用指定模型时，记录实际模型及原因，由 A 选择等价角色替代；此规则不要求为每个常规动作向用户重新申请许可。

## 共享接口和合并

接口变更提案写到 `docs/handoffs/<task-id>-interface.md`：旧签名、新签名、使用者、存档影响及迁移。A 合并后公布新基线，其他 Agent 才依赖。测试共同夹具由 A 合并；模块 Agent 在自己的测试文件中添加独立案例，避免多人改同一 fixture。

每个任务一个 `codex/<task-id>` 分支，集成时检查差异和任务验收，不自动包含其他工作树文件。不允许一个 Agent 改实现、另一个 Agent 同时改同一测试期待来掩盖失败。合并后的跨模块测试由 A 运行，G 复核证据。

## 完成定义

- 实现覆盖任务指定需求，不扩大为战争、逐船管理或聊天驱动的规则引擎。
- 所需检查实际通过；未运行项明确列出原因和影响。
- 新参数有单位、理由和版本；新史实有出处、时段与证据级别。
- 存档/接口变化有迁移或拒绝策略；预览、AI、视觉不改变模拟哈希。
- G 的阻断问题修复后再交 A 集成。没有证据的性能、历史或模型质量判断标为假设。

## 交付模板

```text
任务 / 所有者 / 实际模型与档位：
基线与交付 SHA：
需求与改动文件：
接口输入输出与存档影响：
实际检查命令、退出码与结果：
未执行检查及原因：
史料/参数/资产来源变化：
已知风险与后续负责人：
```
