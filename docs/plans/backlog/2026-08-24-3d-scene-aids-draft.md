# 3D 地面、测量与几何辅助层计划草案

> Status: trigger-gated research-draft
>
> Implementation authorization: no
>
> Version: unassigned；本草案不占版本号
>
> Finalization: 实施前必须执行 [`backlog/README.md`](README.md) 的“转定稿门”

## 1. 推荐结论

推荐建设一套**非标注 overlay 基础设施**，依次承载测距、地面预览和几何特征。辅助结果必须有来源摘要、算法 / 参数版本、图例、可见性、计算状态和缓存边界；默认不进入 Annotation、不参与导出，也不冒充传感器真值。

第一版先做两点 / 多段测距与地面预览。法向、曲率、平面度或杆状特征只有在前两项证明共享 overlay 合同稳定、且有真实使用场景后再加入。

## 2. 当前基线快照

- `geometry/ground.ts` 和 `PointCloudScene` 已能从当前 positions 估计 ground Z，autofit 也能贴底或利用框内点。
- 点云已经有高度色、框内点选择、相机投影、邻帧叠加和 scene 资源生命周期，但这些可视层没有统一的参数、图例、缓存和诊断模型。
- 当前地面估计主要服务内部计算，用户无法检查哪些点被视为地面、置信度如何、是否适合当前坡地 / 室内场景。
- 当前没有明确的 3D 测量对象；如果直接存进 annotations，会污染训练导出与 geometry 枚举。

## 3. Overlay 合同

```text
Point source generation + axis convention
                   │
                   ├─ parameters / algorithm revision
                   ▼
          Overlay compute provider
        ┌──────────┼───────────┐
        ▼          ▼           ▼
    measure      ground     geometry feature
        │          │           │
        └──────────┴───────────┘
                   ▼
 overlay session: status / legend / visibility / cache key
                   │
          ┌────────┴─────────┐
          ▼                  ▼
     WebGL rendering   explicit consumer action
                           ├─ autofit 排除地面
                           └─ future conversion（另行授权）
```

共同字段方向：overlay kind、source point generation / digest、axis convention、algorithm revision、parameters、status、result summary、legend、visibility、created time 和 optional owner。结果可以在页签会话或派生缓存中存在，但不进入 Annotation API。

## 4. 三类辅助层

### 4.1 测量

- 用户在点云中选择两个或多个锚点，显示三维距离、水平距离、垂直高差和单位。
- 锚点必须吸附到有稳定点 ID 的实际点，或明确标为自由空间坐标；两者视觉不同。
- 一次测量可移动、隐藏和删除，仅存在于当前会话；第一版不进入导出。
- 若未来项目存在正式 measurement geometry，再通过独立计划增加“转为标注”，本计划不先造新类型。

### 4.2 地面预览

- 显示地面候选点、非地面点、估计平面 / 高度和置信 / 残差，不只给一条数值。
- 参数变化先更新 overlay preview；只有用户显式执行“拟合时排除地面”才影响下一次候选 / autofit。
- 低置信、坡地、多层地面或点数不足时给出可解释降级，不静默使用错误 ground Z。
- 不删除源点，不自动移动已有 cuboid。

### 4.3 几何特征

- 后置支持法向、曲率、平面度等一小组可解释标量，并用统一 legend 显示。
- 计算进入 Worker，有点数、邻域和耗时硬上限；只计算当前 ROI 或可见 tile。
- 特征结果是判断辅助，不自动生成类别或 annotation。

## 5. 范围

- overlay session / registry、统一状态、图例、参数、可见性、错误、缓存 key 和资源释放。
- 测距工具与会话内测量列表。
- 地面 preview、置信 / 残差解释，以及显式传给新 autofit candidate 的排除参数。
- 通过触发门后的一种几何特征 ROI preview。
- 轴约定、点源 generation、tiling / legacy 路径和切 task 生命周期测试。

## 6. 非范围

- 不增加 measurement annotation 类型，不把辅助层默认导出。
- 不永久删除地面点，不改变源 PCD，不自动重写已有 annotation。
- 不一次实现地面语义分割、道路模型、mesh 重建和通用点云滤镜市场。
- 不把 overlay 设置塞进全局用户偏好；只有跨会话价值被验证后再决定持久化。
- 不让几何特征计算阻塞主线程或要求 WebGPU。

## 7. 触发与顺序

- 测距只需真实标注员确认尺寸判断存在高频需求即可转定稿。
- 地面预览需固定坡地、室内多层、道路和稀疏场景，证明现有 `estimateGroundZ` 的置信边界可解释。
- 几何特征需先明确一个具体任务和能改变决定的指标；“竞品有按钮”不是触发条件。
- 若空间 tiling 已落地，overlay 必须基于 source generation 和完整 ROI；若未落地，保持当前 PCD positions 合同。

## 8. 推荐实现切片（转定稿后执行）

1. **overlay registry + 测距**：先验证生命周期、选择、图例、隐藏和资源释放，不碰 annotation。
2. **地面 preview**：包装现有估计、增加置信和参数，在多个场景对拍。
3. **显式消费**：让“下一次 autofit 排除 preview 地面”产生可撤销候选 / annotation 更新，不改变默认路径。
4. **单一几何特征**：只有触发门通过后，以 ROI Worker 插件接入同一 registry。

## 9. 验收方向

- 开关 / 删除 overlay 不产生 Annotation mutation，也不改变标准导出。
- 测量点、距离和单位在相机移动、布局切换和刷新渲染时稳定；切 task 后不会泄漏到新点云。
- 地面 preview 的输入摘要、参数、残差和置信可复现；低置信场景不会启用自动排除。
- 使用地面排除的 autofit 进入现有 history，一次撤销恢复原 annotation；overlay 本身不混入 annotation undo。
- legacy PCD 和 tile 路径下相同全局点 / 世界坐标得到同一测量结果。
- Worker 取消、参数快速变化和资源淘汰不会让旧结果覆盖新 overlay。

## 10. 风险与回滚

- 辅助层视觉太像 annotation 会误导用户。必须用独立 legend、线型和“辅助结果”标签区分。
- 地面算法在坡地 / 室内易错；置信门和 preview 优先于一键应用。
- 回滚可隐藏 registry 消费入口并清理派生缓存；没有 annotation schema 或源数据需要回滚。已由显式 autofit 更新的框仍按普通 history / revision 管理。

## 11. 转定稿专项检查

- 重新审计 ground、height color、Worker、point generation、layout overlay 和 resource disposal，确认共享层的最小边界。
- 先收集测距和地面样本及任务计时，冻结单位、吸附、置信与参数默认值。
- 核对 3D quality 是否会消费地面结果；两者必须共享 algorithm revision / source digest，不能出现两套 ground 定义。
- 定稿按 registry、测距、地面、显式消费分别列精确文件与测试；几何特征若触发门未过，必须从实施范围移除。
