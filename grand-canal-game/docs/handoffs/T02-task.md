# T02/T03 实施任务

基线 b3221a24be701707688eb609a0cd7393a7f2965c，分支 codex/t02-t03-engineering-labor。

所有者：DeepSeek Harness / deepseek-flash / high；为保留 Codex 调度额度，替代 B/Sol。本轮同一写入者临时承担 A 的共享接口扩展权限；不启动其他写入者。

依次完整实现执行计划的 T02、T03，达到 G1 后停止。不实现 T04+。读取根 AGENTS.md、需求、架构3—6节、T01交接与预检清单。代码路径相对于 grand-canal-game。

允许写入：src/core 的 commands/reducer/projects/preview/invariants/actors/labor/economy/types/tick/index/validation，tests/core/projects.test.ts、labor.test.ts，tests/fixtures，docs/playtests/G1-mechanics.md，docs/handoffs/T02-T03.md，README和执行计划勾选。可新增 scripts/runG1.ts 用于实际三年三策略测量。共享类型变更须在交接中逐条说明。其他文件只读。

完整执行原计划验收，包括：原子指令和去重、预览无状态/随机变化、托管与原出资方退款、已施工取消保全责任、暂停恢复和试航下旬生效；通航日程和关闭期；全部同层封顶按权重及最大余数劳动分配、30/60/5/5案例；战争/宫殿与河工争用；人口不作为库存扣减；累积役负与逐期恢复；无工粮停工；异地到场延迟；精确 peace/conscription/palace-and-canal 夹具；三年三方案真实测量。

沿用事件提议→校验→唯一reducer提交，禁止 any 或全状态任意patch事件。状态与输入均不可变，失败回滚。所有成本/系数用带单位的实验参数，不冒充史实。完成后一次自查、运行 npm test（如 forks EPERM，可 --pool=threads）、npm run typecheck；不得删回归或伪造检查。新测试先失败再实现。不写水利/物流或UI占位冒充完成。

禁止提交、推送、全局配置、子Agent。直接执行，不重新读全局流程技能或询问用户。批量读取，工具命令明确工作目录。不要无限扩大检查范围；绿色后交接。若发现需求矛盾记录明确判断和风险。
