#!/bin/bash
# 上传 GitHub 前运行:检查是否有敏感信息残留
echo "扫描硬编码密钥 / token ..."
hit=$(grep -rniE '(sk-[a-zA-Z0-9]{20,}|bce-v3/[a-zA-Z0-9]|[0-9a-f]{32,}|Bearer [a-zA-Z0-9]{20,})' \
  --include='*.js' --include='*.json' --include='*.html' . 2>/dev/null | grep -v 'check_before_publish')
if [ -n "$hit" ]; then
  echo "⚠  发现疑似密钥,请核查后再上传:"
  echo "$hit"
else
  echo "✓ 未发现硬编码密钥"
fi
echo ""
echo "检查是否误含个人数据文件 ..."
find . \( -name '*backup*.json' -o -name '*.har' -o -name 'test_*.png' \) 2>/dev/null | grep -v node_modules || echo "✓ 无个人数据文件"
