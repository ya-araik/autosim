FROM python:3.12-slim
WORKDIR /app
COPY server/requirements.txt /tmp/runtime-requirements.txt
RUN pip install --no-cache-dir -r /tmp/runtime-requirements.txt gunicorn==26.2.0
COPY server /app/server
COPY scripts/worker.py /app/scripts/worker.py
ENV PYTHONPATH=/app/server PYTHONUNBUFFERED=1
RUN groupadd -g 10001 autosim && useradd -u 10001 -g autosim autosim && mkdir /data /releases && chown autosim:autosim /data
USER 10001:10001
CMD ["gunicorn","--chdir","server","--bind","0.0.0.0:8000","--workers","2","--threads","2","--timeout","60","--access-logfile","/dev/null","wsgi:application"]
