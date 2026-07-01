FROM liferay/node-runner:latest

USER root
RUN apt-get update && apt-get install -y git build-essential && rm -rf /var/lib/apt/lists/*
USER liferay

COPY --chown=liferay:liferay . /opt/liferay

RUN npm install
