# TVBox 多仓配置聚合

把多个 TVBox 单仓配置地址聚合为一个多仓（`stores` 列表），导入 TVBox / 影搜 / 影视仓后即可在仓库选择列表里挑源。

## 直接导入链接

- 主链接（raw）：`https://raw.githubusercontent.com/xiaohuya520/tvbox-dc/main/dc.json`
- 国内镜像（jsDelivr）：`https://cdn.jsdelivr.net/gh/xiaohuya520/tvbox-dc@main/dc.json`

## 说明

- 共 93 条单仓配置（已剔除多仓列表、纯直播源、网页类地址，按 URL 去重）。
- 多仓 JSON 结构：`{ "stores": [ { "name": "源名", "url": "单仓地址" } ] }`。
- 部分小众个人接口可能已失效，导入后列表里点哪个加载哪个，失效的会报错跳过，不影响其他。

## 更新方法

修改 `dc.json` 里的 `stores` 数组后，重新推送到本仓库 `main` 分支即可，导入链接不变。
