# 验证码说明（恋爱观匹配度测试）

- 格式：`LV` + 4 位字符，字符表 `ABCDEFGHJKMNPQRSTUVWXYZ23456789`（无 I/L/O/0/1）
- 示例形态：`LVXXXX`（此处不公布可售卖码）
- 每码最多使用 **3** 次（跨设备共享计数，由 vault 扣次）
- 订单号不是访问码，不会写入 vault，也不会记到 Mantle。格式通过后页面直接开始；「还可以测 N 次」按订单号记在这台浏览器的 `localStorage`（键 `love_values_order_uses`），记满后仍然可以进入
- **重新测试**（访问码）：清除会话解锁后需再次输入码并 redeem，会再扣 1 次
- **重新测试**（订单号）：再记 1 次显示次数。刷新、继续这一次、查看上次结果不改显示次数
- **查看上次结果**：只读本机 `localStorage`，不扣次
- 本仓库**不**存放可卖验证码明文

造码（本机 companion，勿把码写进 git）：

```bash
/workspace/quiz-code-api/scripts/mint.sh values <CODE> 3
```

或见 `tools/mint.sh` 说明。
