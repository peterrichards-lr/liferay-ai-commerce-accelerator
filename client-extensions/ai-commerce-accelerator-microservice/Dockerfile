FROM liferay/node-runner:latest

ENV NODE_VERSION=v22
ENV PATH="/usr/local/node/${NODE_VERSION}/bin:${PATH}"

USER root
RUN apt-get update && apt-get install -y git build-essential python3 && npm install -g yarn && rm -rf /var/lib/apt/lists/*

USER liferay
COPY --chown=liferay:liferay . /opt/liferay

RUN yarn install
