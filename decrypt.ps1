
 = 'Stop'
 = Split-Path -Parent .MyCommand.Path
 = [IO.File]::ReadAllBytes((Join-Path  'oscrypt_dpapi.bin'))
Add-Type -AssemblyName System.Security
 = [Security.Cryptography.ProtectedData]::Unprotect(, , [Security.Cryptography.DataProtectionScope]::CurrentUser)
[IO.File]::WriteAllBytes((Join-Path  'oscrypt.key'), )
Write-Output ("KEY_OK len=" + .Length)
# Decrypt Chromium v10 AES-GCM: enc = v10 | 12-byte nonce | ciphertext+tag
 = [IO.File]::ReadAllBytes((Join-Path  'mcp_tokens.enc'))
if (-not ([0]-eq 118 -and [1]-eq 49 -and [2]-eq 48)) { throw 'bad prefix' }
 = [3..14]
 = [15..(.Length-1)]
# Use BouncyCastle or .NET AesGcm (.NET Core)
Add-Type -AssemblyName System.Security.Cryptography
 = [System.Security.Cryptography.AesGcm]::new()
 = [(.Length-16)..(.Length-1)]
 = [0..(.Length-17)]
 = New-Object byte[] .Length
.Decrypt(, , , )
[IO.File]::WriteAllBytes((Join-Path  'mcp_tokens.json'), )
Write-Output ("TOKENS_OK len=" + .Length)
Write-Output ([Text.Encoding]::UTF8.GetString().Substring(0, [Math]::Min(200, .Length)))
