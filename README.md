# SillyTavern-PixelFarm

简化版网页星露谷：种田 / 采集 / 钓鱼 / 挖矿。基础包 + 可扩展资源包。

## 安装
1. SillyTavern → 顶栏扩展图标（魔方）→ Install extension
2. 输入本仓库的 Git URL，点击 Install
3. 刷新页面，在扩展列表中找到 "Pixel Farm" 启用

或手动安装：将本仓库克隆到
`public/scripts/extensions/third-party/SillyTavern-PixelFarm`，重启 ST。

## 使用
- 扩展设置面板 → "打开农场"，或聊天框输入 `/farm`
- 点击地块循环切换：荒地 → 耕地 → 已浇水
- 点击"睡觉"进入下一天（浇水状态消耗）
- 存档通过 localforage 保存在浏览器本地，自动跨会话保留

## 功能路线
- [x] 扩展骨架 / 设置面板 / 游戏窗口 / 本地存档
- [ ] 时间与季节系统
- [ ] 耕种系统（作物数据驱动）
- [ ] 钓鱼 / 挖矿 / 采集
- [ ] 资源包加载器
- [ ] AI 联动（状态注入 / 宏 / 角色卡片绑定）
