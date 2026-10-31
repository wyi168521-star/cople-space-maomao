# 同一 Wi-Fi 下访问 Love 小家

当前开发电脑的 WLAN 地址为 `192.168.0.212/24`。其他设备使用：

<http://192.168.0.212:3200/login>

## 已配置的地址

- `package.json`：`nuxt dev --dotenv .env.local --host 0.0.0.0 --port 3200`。
- `.env.local`：`NUXT_PUBLIC_SUPABASE_URL=http://192.168.0.212:54321`，沿用本地 anon key。
- `supabase/config.toml`：API 对外地址、Studio 使用的 API 地址和 Auth 确认链接使用 LAN 地址；默认登录返回地址为 `http://192.168.0.212:3200`，并允许该地址下的认证回跳。

`54321` 是 Supabase HTTP API 网关端口，浏览器不需要直接连接 PostgreSQL 的 `54322` 端口。当前 Docker 已将 API 网关映射到所有网卡，不需要添加不存在的 `api.host` 配置。

## 放行 Windows 防火墙

在开发电脑上，以管理员身份打开 PowerShell，执行一次：

```powershell
$loveLanRule = @{
  Direction = 'Inbound'
  Action = 'Allow'
  Protocol = 'TCP'
  Profile = @('Private', 'Public')
  InterfaceAlias = 'WLAN'
  LocalAddress = '192.168.0.212'
  RemoteAddress = '192.168.0.0/24'
}
New-NetFirewallRule -DisplayName 'Love Frontend LAN 3200' -LocalPort 3200 @loveLanRule
New-NetFirewallRule -DisplayName 'Love Supabase API LAN 54321' -LocalPort 54321 @loveLanRule
```

当前 WLAN 的网络类别为 Public，因此规则覆盖 Private 和 Public，并通过网卡、目标 IP 和来源网段限制为本次局域网访问。不需要关闭防火墙。

## 启动和检查

在项目根目录运行：

```powershell
npx supabase start
npm run dev
```

如果修改了 `.env.local` 或开发服务器监听地址，停止旧的 `npm run dev`，再启动。修改 Supabase 配置后，执行 `npx supabase stop`、`npx supabase start`；正常停止会保留本地数据，请勿使用 `--no-backup` 或数据库重置命令。

另一台电脑必须连接同一局域网，使用完整的带端口网址 `http://192.168.0.212:3200/login`。仅输入 IP 会访问默认 80 端口。

若无法打开，在另一台 Windows 电脑执行：

```powershell
Test-NetConnection 192.168.0.212 -Port 3200
Test-NetConnection 192.168.0.212 -Port 54321
```

检查 `TcpTestSucceeded` 是否为 `True`。若主机上正常、其他设备仍不通，检查防火墙规则、访客 Wi-Fi 和路由器的客户端隔离功能。

## 注册与确认邮件

局域网浏览器可以注册；当前设置要求确认邮箱后再登录。本地 Supabase 使用邮件测试箱，不会将确认邮件发送到真实邮箱。

1. 在另一台电脑的 LAN 登录页切换“注册”，填写邮箱、昵称和至少 6 位密码。
2. 在开发电脑打开 <http://127.0.0.1:54324>，找到对应的确认邮件。
3. 复制邮件中的确认链接，在刚才注册的另一台电脑、同一个浏览器中打开。链接应以 `http://192.168.0.212:54321/auth/v1/verify` 开头，确认后返回 LAN 前端。
4. 进入配对页创建空间，或输入对方的空间编号加入。

无需为此开放邮件测试箱端口。旧配置生成的确认邮件可能仍含回环地址；改好地址后应重新发送确认邮件。

## 地址与会话

浏览器将 `127.0.0.1`、`localhost` 和 LAN IP 视为不同站点，改用 LAN 地址后可能需要重新登录。两台电脑统一使用同一个 LAN 网址。

本次配置服务于同一局域网，异地设备无法直接访问此私网 IP。开发电脑需要保持开机、服务保持运行。

以后运行 `ipconfig`，查看 WLAN 的 IPv4 地址。如果地址发生变化，同步修改 `.env.local`、Supabase 的 API/Auth/Studio 地址和防火墙规则，再重启服务；也可在路由器中为开发电脑设置 DHCP 地址保留。
