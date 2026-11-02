# 大运河模拟器 · 河山通鉴

这是一份以中国大运河为主线、兼收灵渠等代表性运河的游戏前期资料库和本地互动地图。首版核读日期：**2026年11月2日**。收录**29项工程、12个历史阶段、35条来源、29项工程量化指标**；不是全国所有地方运河的完整普查。

## 打开互动网页

双击 **[大运河历史地图.html](大运河历史地图.html)**，这是已经内嵌全部样式、脚本与底图的单文件版本，可单独复制使用。另有 **[打开运河地图.bat](打开运河地图.bat)** 与便于修改的 **[dist/index.html](dist/index.html)**。不需要 npm、在线地图、API Key 或互联网。只有点击外部来源链接才需联网。

可以切换时代、查看本期建设与沿用走廊、开关水系图层、搜索工程、点击线路或索引查证据、缩放拖动、看全国总览，并点击**历代叠加**把所有已收录条目放在同一张中国地理参照上。支持下载JSON、单条工程资料和当前视图SVG。

已保存一份可独立使用的 **[历代运河叠加总图.svg](exports/历代运河叠加总图.svg)**，以及 **[网页预览](exports/历代叠加-网页预览.png)**。浏览器交互通过本地HTTP预览核验；浏览器工具不允许 `file://`，故直接文件入口未通过该工具实测。

地图上的**天然水系是现代参照**，历史黄河下游另作分期方向示意。**尚未完成历朝原始天然水系、古湖岸、古海岸及考古河槽的精确复原。**所有古人工河线均为按史料途经点绘制的地理示意，不能拿来测距。全国视图是地理定位图，不是历代疆域或标准政区地图，南海诸岛未详绘。

## 阅读资料

- [资料总索引](index.md)
- [历代工程档案](wiki/01-dynasties-and-engineering.md)：年代、流域、政治动因、工程代价、影响与统计口径。
- [核对与争议](wiki/02-verification-and-disputes.md)：黄河夺淮、通惠河用工、会通河校勘、南旺蠲租、胶莱停运等。
- [地理与制图方法](wiki/03-geography-and-map-method.md)：真实坐标、天然参照、古河示意、时态范围与精度升级路径。
- [政治、经济与社会代价](wiki/04-politics-economy-society.md)
- [游戏机制假说](wiki/05-game-design-hypotheses.md)：明确标为推论，未冒充历史数值。
- [事件年表](wiki/06-events.md)

## 可复用的数据

|文件|内容|
|---|---|
|[atlas.json](data/atlas.json)|完整资料、时期、工程、指标、事件、争议与来源|
|[canals.geojson](data/canals.geojson)|WGS84历史工程**示意**线及属性，供GIS或游戏工具链导入|
|[canals.csv](data/canals.csv)|工程总表，UTF-8 BOM|
|[engineering-metrics.csv](data/engineering-metrics.csv)|原单位指标、口径、限制、来源及古籍原文|
|[sources.csv](data/sources.csv)|来源目录和阅读范围|
|[source-manifest.json](data/source-manifest.json)|来源笔记与古籍节录的SHA-256|
|[geography-manifest.json](data/geography-manifest.json)|Natural Earth原始几何下载链接、许可及哈希|

未知总造价用 `null`，不是0。`start/end` 仅表示本条工程阶段，不代表全线从开始到结束永远通航；日期为范围/概括的条目以 `dateLabel` 和 `uncertainty` 为准。`activeEras` 是有据的主要沿用走廊集合，不是逐年航道状态。

## 核查边界

古籍原文节录见 `raw/S08-excerpts.md`、`S13-excerpts.md`、`S15-excerpts.md`、`S16-excerpts.md`。转录本尚未与影印本逐字校勘。来源登记明确区分相关正文、检索摘要和论文摘要；**不能把“摘要已核”理解成“全文已读”**。机构转载可能来自同一底本，不计作独立多源。来源笔记是研究记录，不是完整网页镜像。

没有将古代里、石、斤和纸钞换成现代人民币/吨；没有捏造死亡数、社会收益金额或统一的历代总造价。会通河的150万缗和通惠河的152万锭均为历史纸币口径，南旺相关110万余石是蠲租。数据与网页均保留这些区别。

## 本地维护与检查

只需系统Python和Node，不需安装第三方依赖；从此文件夹执行：

```powershell
python scripts/build-data.py
python scripts/prepare-map.py
python scripts/package-offline.py
node tests/data-check.cjs
node tests/period-check.cjs
python tests/artifact-check.py
python scripts/verify-vault.py
```

`prepare-map.py` 首次需联网获取公有领域地理数据，此后复用已保存文件。`build-data.py` 不覆盖已有 `raw` 笔记；更新来源时添加新版本，旧版本保留到档案层。修改历史事实时先更新来源记录，再改结构化资料和派生网页。

地理底图：Made with Natural Earth（公有领域）。原始来源及许可证见清单；史料原著、现代论文、网站转载的使用条件分别适用。网页原创代码和研究者概括可在本项目继续改造，不表示拥有原文献的版权。
