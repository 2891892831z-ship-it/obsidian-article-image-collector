[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateNotNullOrEmpty()]
    [string[]] $InputPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

try {
    $fileList = New-Object 'System.Collections.Generic.List[System.IO.FileInfo]'

    foreach ($candidate in $InputPath) {
        foreach ($resolved in @(Resolve-Path -LiteralPath $candidate -ErrorAction Stop)) {
            $item = Get-Item -LiteralPath $resolved.Path -Force

            if ($item.PSIsContainer) {
                $children = Get-ChildItem -LiteralPath $item.FullName -Recurse -File -Filter '*.md' |
                    Where-Object {
                        $_.FullName -notmatch '[\\/](\.git|\.obsidian|node_modules)[\\/]'
                    }

                foreach ($child in $children) {
                    $fileList.Add($child)
                }
            }
            elseif ($item.Extension -ieq '.md') {
                $fileList.Add($item)
            }
            else {
                throw "Input is neither a Markdown file nor a directory: $($item.FullName)"
            }
        }
    }

    $files = @($fileList | Sort-Object FullName -Unique)
    if ($files.Count -eq 0) {
        throw 'No Markdown files were found.'
    }
}
catch {
    [Console]::Error.WriteLine("Markdown math validation could not start: $($_.Exception.Message)")
    exit 2
}

$issues = New-Object 'System.Collections.Generic.List[object]'

function Add-Issue {
    param(
        [string] $File,
        [int] $Line,
        [string] $Code,
        [string] $Problem
    )

    $script:issues.Add([pscustomobject]@{
        File = $File
        Line = $Line
        Code = $Code
        Problem = $Problem
    })
}

foreach ($file in $files) {
    try {
        $text = [System.IO.File]::ReadAllText($file.FullName, [System.Text.Encoding]::UTF8)
    }
    catch {
        [Console]::Error.WriteLine("Cannot read Markdown file: $($file.FullName): $($_.Exception.Message)")
        exit 2
    }

    $lines = [regex]::Split($text, '\r\n|\n|\r')
    $inFence = $false
    $fenceCharacter = ''
    $fenceLength = 0
    $fenceOpeningLine = 0
    $inMath = $false
    $mathOpeningLine = 0
    $lastClosedMathLine = 0

    for ($index = 0; $index -lt $lines.Count; $index++) {
        $line = $lines[$index]
        $lineNumber = $index + 1

        if ($inFence) {
            $closingFence = '^[ ]{0,3}' + [regex]::Escape($fenceCharacter) +
                '{' + $fenceLength + ',}[ \t]*$'

            if ($line -match $closingFence) {
                $inFence = $false
                $fenceCharacter = ''
                $fenceLength = 0
                $fenceOpeningLine = 0
            }

            continue
        }

        if (-not $inMath -and $line -match '^[ ]{0,3}(?<fence>`{3,}|~{3,})') {
            $fence = $Matches['fence']
            $inFence = $true
            $fenceCharacter = $fence.Substring(0, 1)
            $fenceLength = $fence.Length
            $fenceOpeningLine = $lineNumber
            continue
        }

        if ($inMath -and $line -match '^[ ]{0,3}#{1,6}(?:[ \t]+|$)') {
            Add-Issue $file.FullName $lineNumber 'MATH003' "Heading is inside the display-math block opened at line $mathOpeningLine."
        }

        $checkLine = [regex]::Replace($line, '(?<ticks>`+).*?\k<ticks>', '')
        $isMathDelimiter = $checkLine -match '^\s*\$\$\s*$'

        if ($checkLine -match '\$\$' -and -not $isMathDelimiter) {
            Add-Issue $file.FullName $lineNumber 'MATH001' 'Display-math delimiter $$ must be the only content on its line.'
        }

        $containsEquationLabel = $checkLine -match '\{#eq:[^}]+\}'
        $isEquationLabel = $checkLine -match '^\s*\{#eq:[^{}\s]+\}\s*$'

        if ($containsEquationLabel -and -not $isEquationLabel) {
            Add-Issue $file.FullName $lineNumber 'MATH004' 'Equation label must be the only content on its line.'
        }

        if ($isEquationLabel) {
            if ($lastClosedMathLine -ne ($lineNumber - 1)) {
                Add-Issue $file.FullName $lineNumber 'MATH004' 'Equation label must immediately follow a closing $$ line.'
            }

            if ($index + 1 -ge $lines.Count -or -not [string]::IsNullOrWhiteSpace($lines[$index + 1])) {
                Add-Issue $file.FullName $lineNumber 'MATH005' 'Equation label must be followed by a blank line.'
            }
        }

        if ($isMathDelimiter) {
            if ($inMath) {
                $inMath = $false
                $lastClosedMathLine = $lineNumber
            }
            else {
                $inMath = $true
                $mathOpeningLine = $lineNumber
                $lastClosedMathLine = 0
            }
        }
    }

    if ($inFence) {
        Add-Issue $file.FullName $fenceOpeningLine 'FENCE001' 'Fenced code block is not closed; math validation is incomplete.'
    }

    if ($inMath) {
        Add-Issue $file.FullName $mathOpeningLine 'MATH002' 'Display-math block is not closed.'
    }
}

if ($issues.Count -gt 0) {
    Write-Output "Markdown math validation failed: $($issues.Count) issue(s)."
    foreach ($issue in @($issues | Sort-Object File, Line, Code, Problem)) {
        Write-Output ("{0}:{1} [{2}] {3}" -f $issue.File, $issue.Line, $issue.Code, $issue.Problem)
    }
    exit 1
}

Write-Output "Markdown math validation passed: $($files.Count) file(s)."
exit 0
