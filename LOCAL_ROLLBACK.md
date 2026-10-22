# Локальный откат PYRAMID DNA

## Точка восстановления до исправления OCR ориентации

- Исходный commit OCR-исправления: `30a6fb490535a666493076e6cb2ff9957c81070a`
- Рабочая ветка: `codex/pdna-ocr-orientation-fix-20261022`
- Локальная ссылка до начала: `codex/pdna-ocr-prechange-20261022`
- Резервная копия затрагиваемых файлов и исходный diff:
  `/home/arich/.codex/backups/pdna-ocr-20261022`

Чтобы открыть точное состояние до этой доработки, предварительно сохраните
незакоммиченные изменения через `git stash push -u -m "save OCR work"`, затем:

```bash
git switch --detach codex/pdna-ocr-prechange-20261022
```

Для возврата к OCR-доработке выполните `git switch codex/pdna-ocr-orientation-fix-20261022`
и восстановите нужные изменения через `git stash pop`. Эти действия работают
только локально и не обращаются к GitHub.

## Точка восстановления до Final Engineering Sprint

- Исходный commit: `1586f40f95b3b6bb0ed857ef1ad6fce1e9c408d6`
- Рабочая ветка: `codex/pdna-final-sprint`
- Контрольная точка Conversation + OCR + benchmark: `29f0fa5`
- Исходное рабочее дерево перед изменениями было чистым.
- Резервная копия затрагиваемых исходников:
  `/home/arich/Documents/Codex/2026-10-22-pdna-final-sprint-backup`

GitHub и Vercel в этой работе не используются. Команды `git push`, `git pull`,
`git fetch`, GitHub API и удалённый deploy не выполняются.

## Сначала сохранить текущую незавершённую работу

Из корня проекта выполните:

```bash
git status
git diff > ../pdna-final-sprint-working.diff
git diff --staged > ../pdna-final-sprint-staged.diff
git stash push -u -m "save pdna final sprint before rollback"
```

`git stash` сохраняет отслеживаемые и новые файлы. После этого можно безопасно
переключаться между локальными версиями.

## Вернуться к состоянию до спринта

```bash
git switch --detach 1586f40f95b3b6bb0ed857ef1ad6fce1e9c408d6
git status
```

Это создаёт временный detached checkout исходной версии и не переписывает
историю. Для возврата к доработке:

```bash
git switch codex/pdna-final-sprint
git stash list
git stash pop
```

Применяйте `git stash pop` только если нужно вернуть сохранённые сверху
незакоммиченные изменения.

## Восстановить отдельный файл из резервной копии

Скопируйте нужный файл из каталога резервной копии в то же относительное место
проекта. Например:

```bash
cp /home/arich/Documents/Codex/2026-10-22-pdna-final-sprint-backup/pyramid_dna_engine.py ./pyramid_dna_engine.py
```

Перед копированием проверьте `git diff` и сохраните текущую версию файла.
Не используйте `git reset --hard` и `git clean -fd`.
