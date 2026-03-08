IMAGE = mspbgx/schach
TAG = latest

.PHONY: build run push all

build:
	docker build --platform linux/amd64 -t $(IMAGE):$(TAG) .

run:
	docker run -p 3000:3000 $(IMAGE):$(TAG)

push: build
	docker push $(IMAGE):$(TAG)

all: push
