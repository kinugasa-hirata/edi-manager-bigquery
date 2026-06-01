# fix-blur.ps1
# Run from your project root (where src/ is):
#   powershell -ExecutionPolicy Bypass -File fix-blur.ps1
#
# Fixes sticky column transparency issue — replaces bg-inherit + backdropFilter blur
# with solid bg-white so scrolled content goes fully hidden under sticky columns.

$files = Get-ChildItem -Path "src/app/dashboard" -Recurse -Filter "*.tsx" | Select-Object -ExpandProperty FullName

foreach ($file in $files) {
    $content = Get-Content $file -Raw -Encoding UTF8
    $original = $content

    # 1. Remove backdropFilter: 'blur(2px)', (with trailing comma+space)
    $content = $content -replace "backdropFilter: 'blur\(2px\)',\s*", ""

    # 2. Remove backdropFilter: 'blur(2px)' (without trailing comma, last in object)
    $content = $content -replace ",?\s*backdropFilter: 'blur\(2px\)'", ""

    # 3. Replace bg-inherit with bg-white on sticky cells
    $content = $content -replace '(className="[^"]*sticky[^"]*)bg-inherit([^"]*")', '${1}bg-white${2}'

    # 4. Clean up empty style={{ }}
    $content = $content -replace '\s*style=\{\{\s*\}\}', ''

    if ($content -ne $original) {
        # Save as UTF-8 without BOM
        [System.IO.File]::WriteAllText($file, $content, [System.Text.Encoding]::UTF8)
        Write-Host "Fixed: $file" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "Done. Now commit and push." -ForegroundColor Cyan
