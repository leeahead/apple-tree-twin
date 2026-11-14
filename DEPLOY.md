# 推送与部署说明

> 本文件记录这个仓库的远端配置、本机特殊环境，以及日常更新线上站点的操作步骤。
> 换机器、换 agent 或几个月后再回来时，先读这里。

## 1. 仓库与线上地址

| 项目 | 值 |
| --- | --- |
| GitHub 仓库 | https://github.com/leeahead/apple-tree-twin （public） |
| 线上站点 | https://leeahead.github.io/apple-tree-twin/ |
| 默认分支 | `main` |
| Pages 配置 | Source: `main` 分支、根目录 `/`、legacy 构建 |
| 站点入口 | 根目录 `index.html` |

`.nojekyll` 必须保留在仓库根目录：它会关闭 Jekyll，否则以 `_` 开头的文件/目录会被 GitHub Pages 忽略。

## 2. 本机环境的两个坑（重要）

### 2.1 hosts 被劫持

`C:\Windows\System32\drivers\etc\hosts` 里有 30 多行把 GitHub 相关域名指向 `127.0.0.1`，包括：

```
127.0.0.1 api.github.com
127.0.0.1 github.com
127.0.0.1 github.io
127.0.0.1 raw.githubusercontent.com
```

后果：`gh` CLI（依赖 `api.github.com`）会整体不可用，报 502；
设备码授权会一直卡在 `authorization_pending`。

这是某个 GitHub 加速工具留下的，不是本仓库的问题。

### 2.2 SSH 22 端口不通

由于上面的劫持，`git@github.com:22` 经常 `Connection refused`。

**因此本仓库的 origin 特意改成 GitHub 官方的 443 SSH 端口：**

```
ssh://git@ssh.github.com:443/leeahead/apple-tree-twin.git
```

这是 GitHub 官方支持的备用端口，功能与 22 完全一致。

## 3. 日常更新（最常用）

在 `D:\3D果树` 目录下：

```powershell
git add .
git commit -m "说明这次改了什么"
git push
```

`git push` 之后 GitHub Pages 会自动重新构建，通常 30–60 秒生效。
刷新线上地址即可看到更新（必要时用 `Ctrl+F5` 强制刷新，绕过浏览器缓存）。

只想改内容、不想动配置时，就这三条命令，不需要任何 token。

## 4. 换机器 / 重新克隆后的配置

克隆下来后，先把 remote 设成 443 端口，否则在这台机器上推不上去：

```powershell
git clone https://github.com/leeahead/apple-tree-twin.git
cd apple-tree-twin
git remote set-url origin ssh://git@ssh.github.com:443/leeahead/apple-tree-twin.git
```

前提是本机 SSH 公钥已加到 GitHub 账号 `leeahead`。验证：

```powershell
ssh -o BatchMode=yes -p 443 -T git@ssh.github.com
# 期望输出：Hi leeahead! You've successfully authenticated...
```

## 5. 故障排查

### push 报 `Connection refused`

```powershell
# 1) 换端口是否通
ssh -o BatchMode=yes -p 443 -T git@ssh.github.com

# 2) remote 是否真的用了 443
git remote -v
```

remote 必须是 `ssh://git@ssh.github.com:443/...`，不能是 `git@github.com:...`。

### 线上 404 / 样式丢失

- 确认 `.nojekyll` 还在仓库根目录
- 确认 `index.html`、`styles.css`、`src/`、`vendor/` 都推上去了
- 看构建记录：

```powershell
# hosts 劫持了 api.github.com，所以必须用 --resolve 绕开（需要 token）
curl.exe --resolve api.github.com:443:20.205.243.168 ^
  -H "Accept: application/vnd.github+json" ^
  -H "Authorization: token <你的PAT>" ^
  https://api.github.com/repos/leeahead/apple-tree-twin/pages/builds/latest
```

或者直接在网页看：仓库 → Settings → Pages → 最近的构建状态。

### 网页端也打不开 GitHub

说明 hosts 劫持在生效、且加速工具没启动。用公网 DNS 确认真实 IP：

```powershell
Resolve-DnsName api.github.com -Type A -Server 8.8.8.8
```

本次部署时解析结果是 `20.205.243.168`（IP 会变，以实时查询为准）。

## 6. 绝对不要提交的东西

已在 `.gitignore` 中排除，不要为了"推上去看看"而强行 `git add -f`：

- `node_modules/`（约 23M，Three.js 已 vendored 到 `vendor/`，线上不需要 node_modules）
- `.workbuddy/`（项目内部数据）
- `*.log`、系统垃圾文件

另外：

- **不要把 GitHub token / PAT 写进任何文件或提交信息。** 推送走的是 SSH，一次性授权用完即弃。
- `start.bat`、`server.mjs` 是本地开发用的，可以正常提交，线上静态托管不依赖它们。

## 7. 当前提交基线

```
6794e04  Add .nojekyll to disable Jekyll on GitHub Pages
ec88624  Initial commit: MALUS DOMESTICA 苹果树数字孪生（静态可托管）
```

首次部署时 Pages 构建耗时约 26 秒，构建结果 `built`，站点、`styles.css`、
`src/main.js`、`vendor/three/three.module.js` 均返回 200。
