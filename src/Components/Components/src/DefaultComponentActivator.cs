// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.

using System;
using System.Diagnostics.CodeAnalysis;

namespace Microsoft.AspNetCore.Components
{
    internal class DefaultComponentActivator : IComponentActivator
    {
        public static IComponentActivator Instance { get; } = new DefaultComponentActivator();

        /// <inheritdoc />
        [UnconditionalSuppressMessage("ReflectionAnalysis", "IL2067", Justification = "Requires a gesture that ensures components are always preserved. https://github.com/mono/linker/issues/1806")]
        public IComponent CreateInstance(Type componentType)
        {
            var instance = Activator.CreateInstance(componentType);
            if (instance is not IComponent component)
            {
                throw new ArgumentException($"The type {componentType.FullName} does not implement {nameof(IComponent)}.", nameof(componentType));
            }

            return component;
        }
    }
}
