BINARY_NAME=forgeai-node
VERSION=0.1.0
BUILD_DIR=dist
SRC=./cmd/forgeai-node

.PHONY: all clean build linux-amd64 linux-arm64 linux-arm windows-amd64 darwin-amd64 darwin-arm64

all: linux-amd64 linux-arm64 linux-arm windows-amd64

clean:
	rm -rf $(BUILD_DIR)

$(BUILD_DIR):
	mkdir -p $(BUILD_DIR)

# Linux AMD64 (servers, x86 PCs)
linux-amd64: $(BUILD_DIR)
	GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o $(BUILD_DIR)/$(BINARY_NAME)-linux-amd64 $(SRC)

# Linux ARM64 (Raspberry Pi 4/5, modern ARM boards)
linux-arm64: $(BUILD_DIR)
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags="-s -w" -o $(BUILD_DIR)/$(BINARY_NAME)-linux-arm64 $(SRC)

# Linux ARM v7 (Raspberry Pi 2/3, older ARM)
linux-arm: $(BUILD_DIR)
	GOOS=linux GOARCH=arm GOARM=7 CGO_ENABLED=0 go build -ldflags="-s -w" -o $(BUILD_DIR)/$(BINARY_NAME)-linux-armv7 $(SRC)

# Windows AMD64
windows-amd64: $(BUILD_DIR)
	GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o $(BUILD_DIR)/$(BINARY_NAME)-windows-amd64.exe $(SRC)

# macOS AMD64
darwin-amd64: $(BUILD_DIR)
	GOOS=darwin GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o $(BUILD_DIR)/$(BINARY_NAME)-darwin-amd64 $(SRC)

# macOS ARM64 (Apple Silicon)
darwin-arm64: $(BUILD_DIR)
	GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build -ldflags="-s -w" -o $(BUILD_DIR)/$(BINARY_NAME)-darwin-arm64 $(SRC)

# Build for current platform
build: $(BUILD_DIR)
	CGO_ENABLED=0 go build -ldflags="-s -w" -o $(BUILD_DIR)/$(BINARY_NAME) $(SRC)
