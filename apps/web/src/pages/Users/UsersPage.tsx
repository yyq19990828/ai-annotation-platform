import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { StatCard } from "@/components/ui/StatCard";
import { SearchInput } from "@/components/ui/SearchInput";
import { TabRow } from "@/components/ui/TabRow";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { useToastStore } from "@/components/ui/Toast";
import { users, roles } from "@/data/mock";

const ROLE_COLORS: Record<string, "accent" | "ai" | "warning" | "success" | "outline" | "danger"> = {
  项目管理员: "accent",
  审核员: "ai",
  算法工程师: "warning",
  数据工程师: "success",
  标注员: "outline",
  系统管理员: "danger",
};

const STATUS_COLORS: Record<string, "success" | "warning" | "outline"> = {
  在线: "success",
  忙碌: "warning",
  离线: "outline",
};

export function UsersPage() {
  const [tab, setTab] = useState("members");
  const [selectedRole, setSelectedRole] = useState("全部");
  const [query, setQuery] = useState("");
  const pushToast = useToastStore((s) => s.push);

  const filtered = users.filter((u) => {
    if (selectedRole !== "全部" && u.role !== selectedRole) return false;
    if (query && !u.name.includes(query) && !u.email.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  return (
    <div style={{ padding: "20px 28px 40px", maxWidth: 1480, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 4px", letterSpacing: "-0.01em" }}>用户与权限</h1>
          <p style={{ color: "var(--color-fg-muted)", fontSize: 13, margin: 0 }}>管理团队成员、角色权限与数据组分配</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button><Icon name="key" size={13} />API 密钥</Button>
          <Button><Icon name="download" size={13} />导出名单</Button>
          <Button variant="primary" onClick={() => pushToast({ msg: "邀请链接已复制", sub: "7 天内有效", kind: "success" })}>
            <Icon name="plus" size={13} />邀请成员
          </Button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        <StatCard icon="users" label="团队成员" value={users.length} hint="活跃" sparkValues={[8, 9, 9, 10, 10, 11, 11, 11, 12, 12, 12, 12]} sparkColor="var(--color-accent)" />
        <StatCard icon="shield" label="角色组" value={roles.length} hint="自定义" />
        <StatCard icon="check" label="平均准确率" value="96.2%" trend={2} sparkValues={[91, 92, 93, 93, 94, 94, 95, 95, 96, 96, 96, 96]} sparkColor="var(--color-success)" />
        <StatCard icon="activity" label="本周活跃" value="9" hint="昨日 11 人" sparkValues={[6, 7, 8, 7, 9, 10, 11, 9]} sparkColor="var(--color-ai)" />
      </div>

      <Card>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: "1px solid var(--color-border)" }}>
          <TabRow tabs={[`成员 (${users.length})`, `角色 (${roles.length})`, "数据组"]} active={tab === "members" ? `成员 (${users.length})` : tab === "roles" ? `角色 (${roles.length})` : "数据组"} onChange={(t) => {
            if (t.startsWith("成员")) setTab("members");
            else if (t.startsWith("角色")) setTab("roles");
            else setTab("groups");
          }} />
          {tab === "members" && (
            <div style={{ display: "flex", gap: 8 }}>
              <select
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value)}
                style={{ padding: "5px 8px", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", fontSize: 12.5, background: "var(--color-bg-elev)" }}
              >
                <option>全部</option>
                {roles.map((r) => <option key={r.key}>{r.key}</option>)}
              </select>
              <SearchInput placeholder="搜索姓名或邮箱..." value={query} onChange={setQuery} width={240} />
            </div>
          )}
        </div>

        {tab === "members" && (
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 }}>
            <thead>
              <tr>
                {["成员", "角色", "数据组", "状态", "近期标注量", "准确率", "加入时间", ""].map((h, i) => (
                  <th key={i} style={{
                    textAlign: "left", fontWeight: 500, fontSize: 12,
                    color: "var(--color-fg-muted)", padding: "10px 12px",
                    borderBottom: "1px solid var(--color-border)",
                    background: "var(--color-bg-sunken)",
                    ...(i === 0 ? { paddingLeft: 16 } : {}),
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id} style={{ cursor: "pointer" }}>
                  <td style={{ padding: "12px 12px 12px 16px", borderBottom: "1px solid var(--color-border)", verticalAlign: "middle" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Avatar initial={u.initial} size="md" />
                      <div>
                        <div style={{ fontWeight: 500, fontSize: 13.5 }}>{u.name}</div>
                        <div className="mono" style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: 12, borderBottom: "1px solid var(--color-border)", verticalAlign: "middle" }}>
                    <Badge variant={ROLE_COLORS[u.role] || "outline"}>{u.role}</Badge>
                  </td>
                  <td style={{ padding: 12, borderBottom: "1px solid var(--color-border)", verticalAlign: "middle", fontSize: 12.5 }}>{u.group}</td>
                  <td style={{ padding: 12, borderBottom: "1px solid var(--color-border)", verticalAlign: "middle" }}>
                    <Badge variant={STATUS_COLORS[u.status] || "outline"} dot>{u.status}</Badge>
                  </td>
                  <td style={{ padding: 12, borderBottom: "1px solid var(--color-border)", verticalAlign: "middle" }}>
                    {u.tasks > 0 ? (
                      <div>
                        <div className="mono" style={{ fontSize: 13, fontWeight: 500 }}>{u.tasks}</div>
                        <ProgressBar value={Math.min(100, u.tasks / 4)} style={{ marginTop: 3, width: 80 }} />
                      </div>
                    ) : <span style={{ color: "var(--color-fg-subtle)", fontSize: 12 }}>—</span>}
                  </td>
                  <td style={{ padding: 12, borderBottom: "1px solid var(--color-border)", verticalAlign: "middle" }}>
                    {u.accuracy ? (
                      <span className="mono" style={{
                        fontWeight: 500, fontSize: 13,
                        color: u.accuracy > 0.97 ? "var(--color-success)" : u.accuracy > 0.94 ? "var(--color-fg)" : "var(--color-warning)",
                      }}>
                        {(u.accuracy * 100).toFixed(1)}%
                      </span>
                    ) : <span style={{ color: "var(--color-fg-subtle)", fontSize: 12 }}>—</span>}
                  </td>
                  <td style={{ padding: 12, borderBottom: "1px solid var(--color-border)", verticalAlign: "middle", fontSize: 12, color: "var(--color-fg-muted)" }}>{u.joined}</td>
                  <td style={{ padding: 12, borderBottom: "1px solid var(--color-border)", textAlign: "right", verticalAlign: "middle" }}>
                    <Button variant="ghost" size="sm"><Icon name="edit" size={11} /></Button>
                    <Button variant="ghost" size="sm"><Icon name="settings" size={11} /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === "roles" && (
          <div style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
            {roles.map((r) => (
              <div key={r.key} style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-lg)", padding: 14, background: "var(--color-bg-elev)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Badge variant={ROLE_COLORS[r.key] || "outline"} style={{ fontSize: 12, padding: "3px 10px" }}>{r.key}</Badge>
                    <span className="mono" style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>{r.count} 人</span>
                  </div>
                  <Button variant="ghost" size="sm"><Icon name="edit" size={11} />编辑</Button>
                </div>
                <div style={{ fontSize: 12.5, color: "var(--color-fg-muted)", marginBottom: 10 }}>{r.desc}</div>
                <div style={{ fontSize: 11, color: "var(--color-fg-subtle)", marginBottom: 6, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase" }}>权限</div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {r.perms.map((p) => (
                    <Badge key={p} variant="outline" style={{ fontSize: 11 }}>
                      <Icon name="check" size={10} style={{ color: "var(--color-success)" }} />{p}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
            <div style={{
              border: "1.5px dashed var(--color-border-strong)", borderRadius: "var(--radius-lg)",
              padding: 14, display: "flex", alignItems: "center", justifyContent: "center",
              color: "var(--color-fg-muted)", cursor: "pointer", minHeight: 140,
            }}>
              <div style={{ textAlign: "center" }}>
                <Icon name="plus" size={20} />
                <div style={{ marginTop: 6, fontSize: 13 }}>新建自定义角色</div>
              </div>
            </div>
          </div>
        )}

        {tab === "groups" && (
          <div style={{ padding: 16 }}>
            {["标注组A", "标注组B", "标注组C", "质检组", "算法部", "数据组", "运维部"].map((g) => {
              const members = users.filter((u) => u.group === g);
              return (
                <div key={g} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "12px 14px", border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-md)", marginBottom: 8, background: "var(--color-bg-elev)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <Icon name="folder" size={18} style={{ color: "var(--color-fg-muted)" }} />
                    <div>
                      <div style={{ fontWeight: 500, fontSize: 13.5 }}>{g}</div>
                      <div style={{ fontSize: 11.5, color: "var(--color-fg-muted)" }}>{members.length} 名成员</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ display: "flex" }}>
                      {members.slice(0, 5).map((m, i) => (
                        <Avatar key={m.id} initial={m.initial} size="sm" style={{ marginLeft: i ? -6 : 0, border: "2px solid var(--color-bg-elev)" }} />
                      ))}
                      {members.length > 5 && (
                        <Avatar initial={`+${members.length - 5}`} size="sm" style={{ marginLeft: -6, border: "2px solid var(--color-bg-elev)", background: "var(--color-bg-sunken)", color: "var(--color-fg-muted)" }} />
                      )}
                    </div>
                    <Button variant="ghost" size="sm"><Icon name="settings" size={11} /></Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Storage & Model Integrations */}
      <Card style={{ marginTop: 16 }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>存储与模型集成</h3>
          <span style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>系统管理员可见</span>
        </div>
        <div style={{ padding: 14, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
          {[
            { name: "阿里云 OSS", id: "oss-bj-prod", type: "对象存储", used: "4.2 TB / 10 TB", st: "已连接" },
            { name: "MinIO 私有集群", id: "minio-internal", type: "对象存储", used: "880 GB / 5 TB", st: "已连接" },
            { name: "Postgres 元数据", id: "pg-meta-01", type: "数据库", used: "12 GB", st: "已连接" },
            { name: "Claude 3.5 Sonnet", id: "anthropic-api", type: "闭源大模型", used: "API · 6.8k/月", st: "已连接" },
            { name: "GPT-4V", id: "openai-api", type: "闭源大模型", used: "API · 2.1k/月", st: "已连接" },
            { name: "私有化 Qwen2-VL", id: "qwen-onprem", type: "本地部署", used: "GPU 8×A100", st: "已连接" },
          ].map((s) => (
            <div key={s.id} style={{ padding: 12, border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", background: "var(--color-bg-elev)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{s.name}</div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>{s.id}</div>
                </div>
                <Badge variant="success" dot style={{ fontSize: 10 }}>{s.st}</Badge>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--color-fg-muted)" }}>
                <span>{s.type}</span>
                <span className="mono">{s.used}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
