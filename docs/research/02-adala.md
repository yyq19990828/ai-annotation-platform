# Adala:LLM Agent 标注框架

> 拆分自《AI标注平台深度调研报告》§2.2

**仓库**:`HumanSignal/Adala`（Star 1.3k+,月度更新）

## 2.2.1 核心抽象

Adala 不是一个标注 UI,而是一个**让 LLM 跑标注流水线**的框架。核心 4 个抽象:

```
Agent
 ├─ skills: SkillSet(技能集合,可线性 / DAG 编排)
 │           ├─ Skill (单个能力,最小单元)
 │           │   - name / instructions / input_template / output_template
 │           │   - response_model: Type[BaseModel]  ← Pydantic 严格输出 schema
 │           │   - field_schema: JSON schema
 │           ├─ TransformSkill / SampleSkill / SynthesisSkill
 │           └─ collection/  # 内置技能库:
 │              - classification / entity_extraction / qa / rag / summarization
 │              - translation / ontology_creation / prompt_improvement
 │              - **label_studio.py** ← 把 LS 的 XML 配置自动转成 Pydantic 模型
 ├─ runtimes: Dict[str, Runtime]
 │           ├─ OpenAIChatRuntime
 │           ├─ AsyncLiteLLMRuntime  # 接 100+ 模型供应商
 │           └─ AsyncLiteLLMVisionRuntime  # 多模态
 ├─ memories: Memory  # 长期记忆(向量库)
 ├─ environments: Environment  # 数据来源 + 反馈通道
 │           ├─ StaticEnvironment (DataFrame)
 │           ├─ AsyncEnvironment
 │           └─ servers/discord_bot.py 等
 └─ teacher_runtimes  # 用更强模型当老师改进 prompt
```

## 2.2.2 LabelStudioSkill:衔接的精华

```python
class LabelStudioSkill(TransformSkill):
    label_config: str = "<View></View>"   # 拿 LS 的标签 XML
    allowed_control_tags: Optional[list[str]]
    allowed_object_tags: Optional[list[str]]

    @cached_property
    def label_interface(self) -> LabelInterface:
        return LabelInterface(self.label_config)  # 解析 XML

    # 自动从 XML 生成 Pydantic 模型 → LLM 必须输出符合该 schema 的 JSON
    # 通过 instructor / outlines 这种结构化输出库强制约束
```

**为什么强**:LS 用户不需要再单独写一份 prompt 和输出格式,把"配的标签界面"自动变成"LLM 必须遵守的输出 schema"。这就是同一个 owner（HumanSignal）做产品的协同优势。

## 2.2.3 Server 部署形态

`server/app.py`:

```
FastAPI
 ├─ /worker_pool/*    (Worker 池管理 API)
 ├─ /infer/stream     (Kafka 流式推理)
 └─ ...

异步推理链:
   Client → FastAPI → Kafka topic (input)
                    → Celery worker(Adala Agent.run)
                    → Kafka topic (output)
                    → ResultHandler(LS webhook / file / stdout)
```

**生产化设计要点**:
- Kafka 解耦推理请求和工作器,便于水平扩展
- Celery worker 设置 `worker_max_memory_per_child` 防 LLM 内存泄漏
- Redis 既做 Celery broker 又做 worker pool 状态
- LiteLLM 兼容 100+ 供应商,切换模型不改代码
- `CostEstimate` 在跑之前预估 token 成本
