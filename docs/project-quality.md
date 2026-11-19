# 项目质量检查

`open-vibecoding init` 生成项目质量 Skill 和索引，并把入口写入 `AGENTS.md`。初始化登记项目已有命令、配置和文档入口，运行检查时由项目或 Agent 明确选择。项目可在根目录维护 `open-vibecoding.quality.json`，用 `project-quality refresh` 读回变更。质量索引由本地或 CI 生成，项目可提交 Skill 和配置，在新检出目录重建索引。

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
