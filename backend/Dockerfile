FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv/kazi
COPY pyproject.toml ./
COPY app ./app
RUN python -m pip install --no-cache-dir --upgrade "pip>=26.2.2" && pip install --no-cache-dir . && useradd --create-home kazi
USER kazi
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-proxy-headers"]
