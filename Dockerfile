FROM rust:alpine3.18 as builder
RUN apk update &&  \
    apk add musl-dev &&  \
    rustup default nightly &&  \
    cargo +nightly install svm-rs -Z sparse-registry
RUN svm install 0.4.10 && \
    svm install 0.4.26 && \
    svm install 0.5.0 && \
    svm install 0.5.17 && \
    svm install 0.6.0 && \
    svm install 0.6.12 && \
    svm install 0.7.0 && \
    svm install 0.7.6 && \
    svm install 0.8.0 && \
    svm install 0.8.19

FROM ghcr.io/foundry-rs/foundry:latest
ARG NODE_ENV=development
ENV NODE_ENV=${NODE_ENV}
LABEL "network.forta.settings.agent-logs.enable"="true"
COPY --from=builder /root/.svm /root/.svm
WORKDIR /app

RUN apk add --no-cache bash curl coreutils git gcc g++ libstdc++ && \
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.1/install.sh | bash

ENV NVM_DIR="/root/.nvm"
COPY ./.nvmrc .
RUN /bin/bash -c "source $NVM_DIR/nvm.sh --no-use && nvm install && nvm use && nvm alias default $(cat .nvmrc)"

RUN git init && \
    git config --global user.email "docker@docker.com" && \
    git config --global user.name "Docker" && \
    forge install foundry-rs/forge-std --no-commit

COPY ./src ./src
COPY package*.json .env foundry.toml start.sh ./

RUN mkdir test && \
    /bin/bash -c "source $NVM_DIR/nvm.sh --no-use && nvm use && npm ci --production && npm install pm2 -g"

RUN chmod +x start.sh

CMD [ "bash", "start.sh" ]