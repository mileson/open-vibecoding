# 项目质量检查

`open-vibecoding init` 生成 `.agents/skills/project-quality/SKILL.md` 和项目质量索引，并把入口写入 `AGENTS.md`。初始化登记项目已有命令、配置和文档入口，运行检查时由项目或 Agent 明确选择。项目可在根目录维护 `open-vibecoding.quality.json`，用 `project-quality refresh` 读回变更。质量索引由本地或 CI 生成，项目可提交 Skill 和配置，在新检出目录重建索引。

## 登记一个业务规则

```json
{
  "version": 1,
  "checks": [{
    "id": "web.unit",
    "module": "web",
    "layer": "test",
    "paths": ["web", "shared"],
    "argv": ["npm", "run", "test:unit"],
    "required": ["precommit", "pr"]
  }],
  "rules": [{
    "id": "PHOTO-09",
    "title": "最多选 9 张照片",
    "source": "docs/photo-selection.md",
    "cases": [{"id": "photo-limit", "checks": ["web.unit"]}]
  }]
}
```

检查的工作目录是 `module`，作用范围 `paths` 相对仓库根。填写共享组件、配置或跨模块调用方会影响检查的路径。省略 `paths` 表示检查始终适用。检查使用项目信任的可执行文件和独立参数。需要报告时，用 `{artifacts}` 将它写入本次独立证据目录。使用 `test-report e2e` 时可登记 `reportRuns`，要求这些验收在真实的 `results.json` 中执行并检查其状态。完整选图案例包括 Web、iOS 和缺陷对照。 [选图配置](examples/photo-selection-project-quality.json)

## 本地和 GitHub

- 手动验收可执行 `open-vibecoding project-quality run --check web.unit`。重复指定 `--check` 可执行多个检查。
- 已有提交钩子可加入 `open-vibecoding project-quality run --profile precommit`。无钩子时，可把同一行加入项目批准的 hook 或现有钩子管理器。提交前按 Git 暂存路径选择检查，只在未暂存或未跟踪文件与检查范围重叠时阻塞。作用范围未声明时按全项目处理。项目需在范围中登记共享依赖，并沿用能隔离暂存内容的现有 hook。
- CI 在 PR 或合并队列提供的合并候选上运行 `open-vibecoding project-quality run --profile pr --expect web.unit`。将仓库约定的必过 ID 写在工作流调用处，重复 `--expect` 可列出多个。CI 准备项目依赖与 CLI，再上传检查记录和报告。默认检查整个候选，确认项目已覆盖跨模块依赖后可传 `--base <sha>`，并确保两端提交在本地均可读。无关范围记录跳过理由。 [GitHub Actions 示例](examples/project-quality-ci.yml)
- 候选必过项未登记、阻塞或失败时，命令以非零结束。需要 GitHub 拦截合并时，由项目管理员在分支规则上指定必过检查，并按项目现有规则启用合并队列或自动合并。确认合入后按授权清理临时分支和工作区。按平台拆分 CI 时，每个作业可用 `--profile pr --check <该作业负责的必过 ID>`，并让仓库的汇总门禁依赖全部相关作业。通用示例覆盖 Linux 上的 Web 检查。

每次实跑把检查 ID、模块、候选提交、暂存索引指纹、运行时间、状态、理由和证据写在 `.open-vibecoding/artifacts/project-quality/`。记录额外标记工作目录里的未暂存变化与未跟踪文件数量。索引保留各检查最后一次决策和最后一次实际执行，以及可用的 GitHub 运行链接。完整输出留在单次运行目录。上传前核对项目检查是否会输出凭证或私密数据。

发现漏测或反复失败时，沿用项目原有经验候选机制。核验后用正常 PR 维护规则、用例和检查配置。

## 推送前验证

由项目选择是否启用。在项目质量配置将需要阻断推送的检查声明为 `"required": ["prepush"]`，再使用现有 hooks 管理器将以下调用接入原来的 `pre-push`。通过 `--expect` 固定项目要求的检查 ID，便于发现某项登记被误删。此命令读取 Git 提供的完整标准输入。如果现有 hook 也读取输入，可先保存一次，再将同一份内容分别送给原检查和 Open VibeCoding。原检查的非零退出仍应提前中止推送。

```sh
open-vibecoding project-quality pre-push --remote "$1" --expect web.unit
```

每个待更新的 ref 单独检查 Git 提供的对象；即使从当前分支推送别的分支，也检查后者指向的提交。新 ref 与已有 ref 同样执行该提交登记的全量必过项。删除 ref 没有待测提交，报告记为跳过。无法取出提交、含未准备的子模块、缺少必过项或执行失败时阻塞。未启用的项目在索引里可见当前 hook 状态。没有待推送更新时报告为跳过。

检查在临时目录执行，不能依赖当前工作区才有的文件、依赖或运行状态。已有准备命令可登记在 `prepush.prepare.argv`，每个待测提交完成检出后执行，准备过程不得修改已跟踪文件。项目 CLI 可以来自已安装版本，候选配置和测试入口仍来自待推送提交。示例使用项目锁文件准备依赖。

```json
{
  "prepush": {
    "prepare": { "argv": ["npm", "ci", "--no-audit", "--no-fund"] }
  }
}
```

终端会给出推送前报告路径。报告记录本次本地结论与逐项证据。推送命令结束后，可读回本地报告指明的单一命名远端。读回会保留历次观测，确认目标 ref 当前指向哪个提交；对于直接使用 URL 或配置了多个推送地址的远端，请独立核对相应目标。

```sh
open-vibecoding project-quality observe-push --report .open-vibecoding/artifacts/project-quality/<attempt>/push.json
```

本地 hook 由项目成员的 Git 环境执行。项目的共享合并政策仍由现有 CI 和分支规则执行。 [Git pre-push 输入](https://git-scm.com/docs/githooks#_pre_push)
