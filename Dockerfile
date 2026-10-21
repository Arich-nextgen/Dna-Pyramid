FROM node:22-slim AS frontend
WORKDIR /frontend
RUN npm install -g pnpm@11
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm run build
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY api.py cases.py pyramid_dna_engine.py safenet_kz_pyramid_dna_dataset.jsonl ./
COPY --from=frontend /frontend/dist ./frontend/dist
ENV PYRAMID_DNA_CASE_DB=/data/cases.sqlite3
EXPOSE 8000
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8000"]
