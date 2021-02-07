// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

#include "Environment.h"

#include <Windows.h>
#include "exceptions.h"

std::wstring
Environment::ExpandEnvironmentVariables(const std::wstring & str)
{
    DWORD requestedSize = ExpandEnvironmentStringsW(str.c_str(), nullptr, 0);
    if (requestedSize == 0)
    {
        throw std::system_error(GetLastError(), std::system_category(), "ExpandEnvironmentVariables");
    }

    std::wstring expandedStr;
    do
    {
        expandedStr.resize(requestedSize);
        requestedSize = ExpandEnvironmentStringsW(str.c_str(), expandedStr.data(), requestedSize);
        if (requestedSize == 0)
        {
            throw std::system_error(GetLastError(), std::system_category(), "ExpandEnvironmentVariables");
        }
    } while (expandedStr.size() != requestedSize);

    // trim null character as ExpandEnvironmentStringsW returns size including null character
    expandedStr.resize(requestedSize - 1);

    return expandedStr;
}

std::optional<std::wstring>
Environment::GetEnvironmentVariableValue(const std::wstring & str)
{
    DWORD requestedSize = GetEnvironmentVariableW(str.c_str(), nullptr, 0);
    if (requestedSize == 0)
    {
        if (GetLastError() == ERROR_ENVVAR_NOT_FOUND)
        {
            return std::nullopt;
        }

        throw std::system_error(GetLastError(), std::system_category(), "GetEnvironmentVariableW");
    }
    else if (requestedSize == 1)
    {
        // String just contains a nullcharacter, return nothing
        // GetEnvironmentVariableW has inconsistent behavior when returning size for an empty
        // environment variable.
        return std::nullopt;
    }

    std::wstring expandedStr;
    do
    {
        expandedStr.resize(requestedSize);
        requestedSize = GetEnvironmentVariableW(str.c_str(), expandedStr.data(), requestedSize);
        if (requestedSize == 0)
        {
            if (GetLastError() == ERROR_ENVVAR_NOT_FOUND)
            {
                return std::nullopt;
            }
            throw std::system_error(GetLastError(), std::system_category(), "ExpandEnvironmentStringsW");
        }
    } while (expandedStr.size() != requestedSize + 1);

    expandedStr.resize(requestedSize);

    return expandedStr;
}

std::wstring Environment::GetCurrentDirectoryValue()
{
    DWORD requestedSize = GetCurrentDirectory(0, nullptr);
    if (requestedSize == 0)
    {
        throw std::system_error(GetLastError(), std::system_category(), "GetCurrentDirectory");
    }

    std::wstring expandedStr;
    do
    {
        expandedStr.resize(requestedSize);
        requestedSize = GetCurrentDirectory(requestedSize, expandedStr.data());
        if (requestedSize == 0)
        {
            throw std::system_error(GetLastError(), std::system_category(), "GetCurrentDirectory");
        }
    } while (expandedStr.size() != requestedSize + 1);

    expandedStr.resize(requestedSize);

    return expandedStr;
}

std::wstring Environment::GetDllDirectoryValue()
{
    // GetDllDirectory can return 0 in both the success case and the failure case, and it only sets last error when it fails.
    // This requires you to set the last error to ERROR_SUCCESS before calling it in order to detect failure.
    SetLastError(ERROR_SUCCESS);

    DWORD requestedSize = GetDllDirectory(0, nullptr);
    if (requestedSize == 0)
    {
        if (GetLastError() != ERROR_SUCCESS)
        {
            throw std::system_error(GetLastError(), std::system_category(), "GetDllDirectory");
        }
        else
        {
            return L"";
        }
    }

    std::wstring expandedStr;
    do
    {
        expandedStr.resize(requestedSize);
        requestedSize = GetDllDirectory(requestedSize, expandedStr.data());
        // 0 might be returned if GetDllDirectory is empty
        if (requestedSize == 0 && GetLastError() != ERROR_SUCCESS)
        {
            throw std::system_error(GetLastError(), std::system_category(), "GetDllDirectory");
        }
    } while (expandedStr.size() != requestedSize + 1);

    expandedStr.resize(requestedSize);

    return expandedStr;
}

bool Environment::IsRunning64BitProcess()
{
    // Check the bitness of the currently running process
    // matches the dotnet.exe found.
    BOOL fIsWow64Process = false;
    THROW_LAST_ERROR_IF(!IsWow64Process(GetCurrentProcess(), &fIsWow64Process));

    if (fIsWow64Process)
    {
        // 32 bit mode
        return false;
    }

    // Check the SystemInfo to see if we are currently 32 or 64 bit.
    SYSTEM_INFO systemInfo;
    GetNativeSystemInfo(&systemInfo);
    return systemInfo.wProcessorArchitecture == PROCESSOR_ARCHITECTURE_AMD64;
}

HRESULT Environment::CopyToDirectory(std::filesystem::path destination, std::wstring source, bool cleanDest)
{
    std::wstring tempPath = destination;
    if (tempPath.find(source) == 0)
    {
        // In the same directory, block.
        return E_FAIL;
    }

    if (cleanDest && std::filesystem::exists(destination))
    {
        std::filesystem::remove_all(destination);
    }

    // Always does a copy on startup, as if there are not files to update
    // this copy should be fast.
    //"C:\inetpub\wwwroot\", "C:\inetpub\ShadowCopyDirectory\1"'
    Environment::CopyDirTo(source, destination.wstring());
    return S_OK;
}

bool Environment::CopyDirTo( const std::wstring& source_folder, const std::wstring& target_folder )
{
    std::wstring new_sf = source_folder + L"\\*";
    WCHAR sf[MAX_PATH+1];
    WCHAR tf[MAX_PATH+1];

    wcscpy_s(sf, MAX_PATH, new_sf.c_str());
    wcscpy_s(tf, MAX_PATH, target_folder.c_str());

    sf[lstrlenW(sf)+1] = 0;
    tf[lstrlenW(tf)+1] = 0;

    SHFILEOPSTRUCTW s = { 0 };
    s.wFunc = FO_COPY;
    s.pTo = tf;
    s.pFrom = sf;
    s.fFlags = FOF_SILENT | FOF_NOCONFIRMMKDIR | FOF_NOCONFIRMATION | FOF_NOERRORUI | FOF_NO_UI;
    int res = SHFileOperationW( &s );

    return res == 0;
}
