// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.

#nullable enable

using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.AspNetCore.Routing;
using Moq;
using Xunit;

namespace Microsoft.AspNetCore.Builder
{
    public class MapActionEndpointDataSourceBuilderExtensionsTest
    {
        private ModelEndpointDataSource GetBuilderEndpointDataSource(IEndpointRouteBuilder endpointRouteBuilder)
        {
            return Assert.IsType<ModelEndpointDataSource>(Assert.Single(endpointRouteBuilder.DataSources));
        }

        private RouteEndpointBuilder GetRouteEndpointBuilder(IEndpointRouteBuilder endpointRouteBuilder)
        {
            return Assert.IsType<RouteEndpointBuilder>(Assert.Single(GetBuilderEndpointDataSource(endpointRouteBuilder).EndpointBuilders));
        }

        [Fact]
        public void MapAction_BuildsEndpointFromAttributes()
        {
            const string customMethod = "CUSTOM_METHOD";
            const string customTemplate = "/CustomTemplate";

            [HttpMethods(new[] { customMethod }, customTemplate)]
            void MyAction() { };

            var builder = new DefaultEndpointRouteBuilder(Mock.Of<IApplicationBuilder>());
            var endpointBuilder = builder.MapAction((Action)MyAction);

            var dataSource = Assert.Single(builder.DataSources);
            var endpoint = Assert.Single(dataSource.Endpoints);

            var httpMethodMetadata = Assert.Single(endpoint.Metadata.OfType<IHttpMethodMetadata>());
            var method = Assert.Single(httpMethodMetadata.HttpMethods);
            Assert.Equal(customMethod, method);

            var routeEndpointBuilder = GetRouteEndpointBuilder(builder);
            Assert.Equal(customTemplate, routeEndpointBuilder.RoutePattern.RawText);
        }

        private class HttpMethodsAttribute : Attribute, IRouteTemplateProvider, IHttpMethodMetadata
        {
            public HttpMethodsAttribute(string[] httpMethods, string? template)
            {
                HttpMethods = httpMethods;
                Template = template;
            }

            public string? Template { get; }

            public IReadOnlyList<string> HttpMethods { get; }

            public int? Order => null;

            public string? Name => null;

            public bool AcceptCorsPreflight => false;
        }
    }
}
