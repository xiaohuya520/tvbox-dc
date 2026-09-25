# TVBox 多仓配置聚合

把多个 TVBox 单仓配置地址聚合为一个多仓，导入 TVBox / 影搜 / 影视仓后即可在仓库选择列表里挑源。

## 直接导入链接

- **精选版（20 条，推荐日常用）**：`https://raw.githubusercontent.com/xiaohuya520/tvbox-dc/main/dc.json`
  - 国内镜像：`https://cdn.jsdelivr.net/gh/xiaohuya520/tvbox-dc@main/dc.json`
- 完整版（93 条，备用）：`https://raw.githubusercontent.com/xiaohuya520/tvbox-dc/main/dc_full.json`
  - 国内镜像：`https://cdn.jsdelivr.net/gh/xiaohuya520/tvbox-dc@main/dc_full.json`

## 格式说明（双兼容）

`dc.json` / `dc_full.json` 同一个文件里同时提供两种多仓字段，适配不同壳子：

- `stores`：元素 `{ "name": "源名", "url": "单仓地址" }`（影搜 / 影视仓常用）
- `urls`：元素 `{ "url": "单仓地址", "name": "源名" }`（参考 GitLab 多多类合集写法，部分 TVBox 魔改版只认这个）

两种字段内容完全一致，只是字段顺序/命名不同。壳子一般只读自己认识的那个字段，互不影响。

## 精选版 20 条清单

> 按知名维护者 / github·gitlab 直链 / 长期稳定域名筛选；剔除了 IP 直连、短链(pastebin/teach.link/Link3.cc)、纯个人小站、重复项。无法实测存活，导入后点哪个加载哪个，失效的会报错跳过。

1. 饭太硬 · 2. 潇洒 · 3. ok(liucn) · 4. 老刘备 · 5. 摸鱼儿 · 6. 飞猫(ls660) · 7. PG · 8. FongMi · 9. noimank · 10. 欧歌接口 · 11. 影视仓 · 12. 王二小 · 13. 香雅情 · 14. ZYplayer · 15. 宝盒VIP · 16. 少儿频道 · 17. 极速 · 18. TvBox单仓 · 19. CatVodSpider · 20. clun-fun

## 更新方法

修改对应 `dc.json` / `dc_full.json` 里的 `stores` / `urls` 数组后（两个字段保持同步），重新推送到本仓库 `main` 分支即可，导入链接不变。
